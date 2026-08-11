import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { loadCo2eCostSeries, loadCo2eFactors } from "@/lib/emissions";
import { computePriceForecast, type PriceForecast } from "@/lib/priceForecast";
import { computeTrendSignal } from "@/lib/priceTrend";
import { getPortPrices } from "@/lib/prices";
import {
  matchSpotRequest,
  resolveEmissionsCostUsdPerMt,
  type SpotMatchResult,
} from "@/lib/spotMatch";
import {
  simulateBunkering,
  type BunkeringSimulation,
} from "@/lib/spotSimulation";
import { tankFor, type SpotBunkerRequest, type SpotContext } from "@/lib/spotBunker";
import { getPortMarkets } from "@/lib/suppliers";
import type { VesselSpec } from "@/lib/types";

/**
 * Deterministic supplier match for a spot bunker requirement, plus a one-shot
 * LLM narrative over the already-computed result.
 *
 * The pipeline (matchSpotRequest / simulateBunkering) is pure and produces
 * every number in the response. Claude is handed that output verbatim and
 * asked only for prose — it never recomputes or overrides a figure. If the
 * narrative call fails for any reason (missing key, rate limit, network),
 * the deterministic result is still returned: it is self-sufficient, and a
 * prose-generation failure should never throw away a working answer.
 */

const MODEL = "claude-haiku-4-5";

interface RequestBody {
  request: SpotBunkerRequest;
  ctx: SpotContext;
  spec: VesselSpec;
}

export interface Narrative {
  headline: string;
  reasons: string[];
  risks: string[];
  simulationNarrative: string;
}

/** Tank-to-wake mass for this nomination — the $ side already lives on RankedOffer. */
export interface EmissionsEstimate {
  co2eTonnes: number;
  co2eFactorTPerMt: number;
}

export interface SpotMatchApiResponse {
  result: SpotMatchResult;
  simulation: BunkeringSimulation | null;
  narrative: Narrative | null;
  narrativeError: string | null;
  emissions: EmissionsEstimate | null;
  priceForecast: PriceForecast | null;
}

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One sentence naming the winning supplier and the headline reason it wins on cost.",
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description:
        "3 to 6 short bullet reasons supporting the recommendation, each grounded in a figure from the given data.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description:
        "0 to 3 short caveats or risks worth flagging (e.g. a headroom warning, a tight lead time). Empty array if there are none.",
    },
    simulationNarrative: {
      type: "string",
      description:
        "1-2 sentences describing the cost breakdown and ROB trajectory in the given simulation.",
    },
  },
  required: ["headline", "reasons", "risks", "simulationNarrative"],
  additionalProperties: false,
} as const;

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<RequestBody>;
  const spotRequest = body.request;
  const ctx = body.ctx;
  const spec = body.spec;

  if (!spotRequest || !ctx || !spec) {
    return NextResponse.json(
      { error: "Missing request, ctx, or spec." },
      { status: 400 },
    );
  }
  if (
    spotRequest.grade === null ||
    spotRequest.nominationMt === null ||
    spotRequest.nominationMt <= 0
  ) {
    return NextResponse.json(
      { error: "Nominate a grade and a positive quantity before matching." },
      { status: 400 },
    );
  }
  if (!ctx.portCode) {
    return NextResponse.json(
      { error: "No port resolved for this vessel's current leg." },
      { status: 400 },
    );
  }

  const market =
    getPortMarkets(ctx.portCode).find((m) => m.grade === spotRequest.grade) ??
    null;

  const prices = getPortPrices(ctx.portCode);
  const gradeSeries = prices[spotRequest.grade] ?? [];
  const trend = computeTrendSignal(gradeSeries);
  const priceForecast = computePriceForecast(gradeSeries, trend);

  const emissionsCostUsdPerMt = resolveEmissionsCostUsdPerMt(
    loadCo2eCostSeries(),
    tankFor(spotRequest.grade),
    ctx.arrivalTimestamp,
  );

  const co2eFactorTPerMt = loadCo2eFactors()[tankFor(spotRequest.grade)];
  const emissions: EmissionsEstimate = {
    co2eTonnes:
      Math.round(co2eFactorTPerMt * spotRequest.nominationMt * 100) / 100,
    co2eFactorTPerMt,
  };

  const result = matchSpotRequest({
    request: spotRequest,
    ctx,
    market,
    emissionsCostUsdPerMt,
    trend,
  });

  if (result.winner === null) {
    // Nothing survived filtering (or no market at all) — nothing to narrate.
    return NextResponse.json({
      result,
      simulation: null,
      narrative: null,
      narrativeError: null,
      emissions,
      priceForecast,
    } satisfies SpotMatchApiResponse);
  }

  const winner = result.winner;
  const simulation = simulateBunkering(spotRequest, ctx, spec, winner);
  const { narrative, error: narrativeError } = await generateNarrative(
    result,
    simulation,
  );

  return NextResponse.json({
    result,
    simulation,
    narrative,
    narrativeError,
    emissions,
    priceForecast,
  } satisfies SpotMatchApiResponse);
}

async function generateNarrative(
  result: SpotMatchResult,
  simulation: BunkeringSimulation,
): Promise<{ narrative: Narrative | null; error: string | null }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { narrative: null, error: "ANTHROPIC_API_KEY is not configured." };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You are writing a short procurement explanation for a bunker fuel " +
        "supplier recommendation. Every number you are given below is " +
        "already computed and final — do not recompute, alter, invent, or " +
        "contradict any figure. Reference the given values verbatim in your " +
        "prose. Write only the requested prose.",
      output_config: {
        format: { type: "json_schema", schema: NARRATIVE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: JSON.stringify({ result, simulation }),
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { narrative: null, error: "No narrative text returned." };
    }

    return { narrative: JSON.parse(textBlock.text) as Narrative, error: null };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return {
        narrative: null,
        error: "Rate limited while generating the explanation.",
      };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return {
        narrative: null,
        error: "Could not reach the narrative service.",
      };
    }
    if (err instanceof Anthropic.APIError) {
      return {
        narrative: null,
        error: `Narrative generation failed: ${err.message}`,
      };
    }
    return { narrative: null, error: "Narrative generation failed unexpectedly." };
  }
}
