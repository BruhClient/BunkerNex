"use client";

import { GRADE_COLORS, GRADE_LABELS } from "@/lib/colors";
import { VESSEL_GRADES, type VesselGrade } from "@/lib/types";

interface Props {
  fuelGrades: Set<VesselGrade>;
  onToggle: (grade: VesselGrade) => void;
}

/**
 * "Fuel type" section. VesselGrade, not the wider Grade — these are the six
 * grades the fleet actually burns, matching what a vessel can be filtered by.
 */
export default function FuelFilters({ fuelGrades, onToggle }: Props) {
  return (
    <div className="border-b border-line">
      <div className="px-4 py-2.5">
        <span className="label">Fuel type</span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {VESSEL_GRADES.map((grade) => {
          const on = fuelGrades.has(grade);
          const color = GRADE_COLORS[grade];
          return (
            <button
              key={grade}
              type="button"
              onClick={() => onToggle(grade)}
              aria-pressed={on}
              className="flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: on ? color : "var(--color-line-strong)",
                background: on ? `${color}26` : "transparent",
                color: on ? color : "var(--color-muted)",
              }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: color }}
              />
              {GRADE_LABELS[grade]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
