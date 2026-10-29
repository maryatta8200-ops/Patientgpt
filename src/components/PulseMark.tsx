/** The Pulse mark — a heartbeat trace inside a soft gradient tile. */

export function PulseMark({ size = 36, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-[26%]"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(145deg, #3af0d1 0%, #35d0ff 55%, #8b7bff 100%)',
        boxShadow: glow
          ? '0 12px 30px -14px rgba(46,230,197,0.9), inset 0 1px 0 rgba(255,255,255,0.5)'
          : 'none',
      }}
      aria-hidden
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#04140f"
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12.6h4l2.2-6.6 3.6 12.6 2.6-8.4 1.8 4H22" />
      </svg>
    </div>
  );
}
