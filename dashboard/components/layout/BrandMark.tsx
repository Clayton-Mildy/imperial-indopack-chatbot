/**
 * The Royale "S" (a gold letter in a white circle) beside IMPERIAL INDOPACK, as in the sidebar
 * header of every screen design. public/icon.svg draws the same mark for the app icon.
 */
export function BrandMark() {
  return (
    <>
      <div
        aria-hidden="true"
        className="font-heading"
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "#FFFFFF",
          border: "1px solid #E2D3B2",
          color: "#8A6A2A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        S
      </div>
      <span
        className="font-heading"
        style={{ color: "#445428", fontWeight: 800, fontSize: 14, letterSpacing: "0.04em" }}
      >
        IMPERIAL INDOPACK
      </span>
    </>
  );
}
