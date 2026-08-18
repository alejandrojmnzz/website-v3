import { cn } from "@/lib/utils";
import type { DailyHitCount } from "@shared/runtime-issues";

const W = 112;
const H = 32;
const PAD = { top: 4, right: 2, bottom: 4, left: 2 };

interface RuntimeIssuesSparklineProps {
  series: DailyHitCount[];
  total: number;
  windowDays: 7 | 30;
  className?: string;
}

function formatDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function buildPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

export function RuntimeIssuesSparkline({
  series,
  total,
  windowDays,
  className,
}: RuntimeIssuesSparklineProps) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(0, ...series.map((p) => p.count));
  const n = series.length;
  const midY = PAD.top + innerH / 2;
  const empty = n === 0 || max === 0;

  const points = series.map((p, i) => ({
    x: n <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW,
    y: empty ? midY : PAD.top + (1 - p.count / max) * innerH,
    day: p.day,
    count: p.count,
  }));

  const pathD = buildPath(points);
  const last = points[points.length - 1];
  const areaD =
    points.length > 0
      ? `${pathD} L ${points[points.length - 1].x} ${PAD.top + innerH} L ${points[0].x} ${PAD.top + innerH} Z`
      : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={
        empty
          ? `No hits in the last ${windowDays} days`
          : `${total} hits in the last ${windowDays} days`
      }
      data-testid="runtime-issues-sparkline"
    >
      <title>
        {empty
          ? `No hits in the last ${windowDays} days`
          : `${total} hits in the last ${windowDays} days`}
      </title>
      <defs>
        <linearGradient id="runtime-issues-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {empty ? (
        <line
          x1={PAD.left}
          y1={midY}
          x2={PAD.left + innerW}
          y2={midY}
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.5"
        />
      ) : (
        <>
          {areaD && <path d={areaD} fill="url(#runtime-issues-spark-fill)" />}
          <path
            d={pathD}
            fill="none"
            stroke="hsl(var(--destructive))"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {last && (
            <circle cx={last.x} cy={last.y} r="2.25" fill="hsl(var(--destructive))" />
          )}
        </>
      )}
      {points.map((p) => (
        <rect
          key={p.day}
          x={p.x - innerW / Math.max(n, 1) / 2}
          y={0}
          width={Math.max(innerW / Math.max(n, 1), 4)}
          height={H}
          fill="transparent"
        >
          <title>
            {formatDayLabel(p.day)}: {p.count} {p.count === 1 ? "hit" : "hits"}
          </title>
        </rect>
      ))}
    </svg>
  );
}
