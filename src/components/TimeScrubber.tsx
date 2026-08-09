"use client";

import { useEffect, useRef, useState } from "react";

/** Steps advanced per second of playback — 12 steps/s covers 93 days in ~60s. */
const STEPS_PER_SECOND = 12;

/**
 * Half the slider thumb, in px — see .bn-scrub::-webkit-slider-thumb.
 *
 * The thumb's centre travels from `HALF_THUMB` to `width - HALF_THUMB`, not
 * across the full width, so a tick placed at a bare percentage drifts visibly
 * at both ends of the track.
 */
const HALF_THUMB = 6;

interface Props {
  /** Number of steps in the series; the slider runs 0 .. stepCount - 1. */
  stepCount: number;
  stepIndex: number;
  /** Pre-formatted source timestamp. Never re-parsed here. */
  label: string;
  /** Steps carrying a bunker stem, deduped — several stems land on one step. */
  markSteps?: number[];
  onChange: (step: number) => void;
}

export default function TimeScrubber({
  stepCount,
  stepIndex,
  label,
  markSteps,
  onChange,
}: Props) {
  const [playing, setPlaying] = useState(false);

  // The interval callback must see the current step without being torn down
  // and rebuilt every tick, which would reset the timer and stall playback.
  const stepRef = useRef(stepIndex);
  stepRef.current = stepIndex;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!playing) return;

    const id = window.setInterval(() => {
      const next = stepRef.current + 1;
      // Stop at the end rather than looping: the series is a fixed 93-day
      // window, and wrapping would imply a continuity the data does not have.
      if (next >= stepCount) {
        setPlaying(false);
        return;
      }
      onChangeRef.current(next);
    }, 1000 / STEPS_PER_SECOND);

    return () => window.clearInterval(id);
  }, [playing, stepCount]);

  const atEnd = stepIndex >= stepCount - 1;

  return (
    // Not positioned here: Explorer stacks this under the bunker log inside
    // one bottom-anchored column, so the two compose by height.
    <div className="flex items-center gap-3 border-t border-line bg-bg/90 px-4 py-2.5 backdrop-blur">
      <button
        type="button"
        onClick={() => {
          // Pressing play at the end restarts rather than doing nothing.
          if (atEnd && !playing) onChange(0);
          setPlaying((p) => !p);
        }}
        aria-label={playing ? "Pause playback" : "Play vessel movement"}
        className="flex size-8 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <rect x="2.5" y="2" width="3.5" height="10" fill="currentColor" />
            <rect x="8" y="2" width="3.5" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M3 1.5 L12 7 L3 12.5 Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div className="relative min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(stepCount - 1, 0)}
          step={1}
          value={stepIndex}
          onChange={(e) => {
            setPlaying(false);
            onChange(Number(e.target.value));
          }}
          aria-label="Vessel position time"
          aria-valuetext={label}
          className="bn-scrub w-full"
        />

        {/* Where the fleet bunkers. Decorative — the log is the readable form
            of the same events, and the slider keeps its own labels. */}
        {stepCount > 1 &&
          markSteps?.map((step) => (
            <span
              key={step}
              aria-hidden
              className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-accent/60"
              style={{
                left: `calc(${HALF_THUMB}px + (100% - ${HALF_THUMB * 2}px) * ${
                  step / (stepCount - 1)
                })`,
              }}
            />
          ))}
      </div>

      <div className="shrink-0 text-right">
        <div className="label leading-none">Vessel positions</div>
        {/* The source carries no timezone, so the string is shown exactly as
            stored — any locale conversion would silently shift it. */}
        <div className="tnum mt-0.5 text-xs text-fg">{label}</div>
      </div>
    </div>
  );
}
