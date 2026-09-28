import type { PieceType } from '@four-chess/engine';

// Flat vector pieces drawn in a 45x45 box. The parent <g> supplies
// fill/stroke; internal lines mark the usual part breaks like a printed set.

const BASE = 'M13 34.5 h19 q2 0 2 2 v2.5 h-23 v-2.5 q0-2 2-2 Z';

function Pawn() {
  return (
    <>
      <circle cx={22.5} cy={10.5} r={5} />
      <path d="M18.5 14.5 h8 l1.3 3.6 c2.8 3.4 4.2 7.4 4.2 11.9 h-19 c0-4.5 1.4-8.5 4.2-11.9 Z" />
      <path d={BASE} />
    </>
  );
}

function Rook() {
  return (
    <>
      <path d="M13.5 8 h4.5 v3.5 h3 V8 h3 v3.5 h3 V8 h4.5 v7 l-2.8 3 v11.5 l2.8 3.5 h-18 l2.8 -3.5 V18 l-2.8 -3 Z" />
      <path d="M16.6 18 h11.8 M16.6 29.8 h11.8" fill="none" strokeWidth={1.3} />
      <path d={BASE} />
    </>
  );
}

function Knight() {
  return (
    <>
      <path d="M14.6 33.5 c0 -8 1.8 -13 5.4 -16.2 c-1.9 -0.3 -3.5 0.3 -4.9 1.5 c-1.5 -2.3 -1 -5.1 0.8 -7.3 c1.3 -1.6 3 -2.8 4.8 -3.4 l1 -3.6 l2.4 3 c5.7 0.6 10.1 5.2 11 11.7 c0.7 5 0.2 9.8 -0.3 14.3 Z" />
      <circle cx={20.7} cy={15.2} r={1.15} fill="#111827" stroke="none" />
      <path d={BASE} />
    </>
  );
}

function Bishop() {
  return (
    <>
      <circle cx={22.5} cy={7.6} r={2.4} />
      <path d="M22.5 11.2 c4.4 2.8 7 6.8 7 10.7 c0 2.8 -1.2 4.9 -2.6 6.1 h-8.8 c-1.4 -1.2 -2.6 -3.3 -2.6 -6.1 c0 -3.9 2.6 -7.9 7 -10.7 Z" />
      <path d="M22.5 14.8 v6.4 M19.6 18 h5.8" fill="none" strokeWidth={1.3} />
      <path d="M16.3 29.7 h12.4 l1.9 3.2 h-16.2 Z" />
      <path d={BASE} />
    </>
  );
}

function Queen() {
  return (
    <>
      <path d="M12.6 20.5 L10.6 10.2 L16.9 15 L22.5 7.6 L28.1 15 L34.4 10.2 L32.4 20.5 Z" />
      <circle cx={10.6} cy={9} r={1.7} />
      <circle cx={22.5} cy={6.2} r={1.7} />
      <circle cx={34.4} cy={9} r={1.7} />
      <path d="M13.8 22.3 h17.4 c1 3.6 0.3 7.3 -1.9 10.2 h-13.6 c-2.2 -2.9 -2.9 -6.6 -1.9 -10.2 Z" />
      <path d={BASE} />
    </>
  );
}

function King() {
  return (
    <>
      <path d="M21.2 3.5 h2.6 v3.2 h3.1 v2.6 h-3.1 v3.4 h-2.6 V9.3 h-3.1 V6.7 h3.1 Z" />
      <path d="M15.4 15.8 h14.2 c2.5 3.5 3.1 9 1.6 13.9 v2.8 h-17.4 v-2.8 C12.3 24.8 12.9 19.3 15.4 15.8 Z" />
      <path d="M14.6 21.5 c2.4 -1.8 13.4 -1.8 15.8 0" fill="none" strokeWidth={1.3} />
      <path d={BASE} />
    </>
  );
}

export function PieceIcon({ type }: { type: PieceType }) {
  switch (type) {
    case 'P':
      return <Pawn />;
    case 'R':
      return <Rook />;
    case 'N':
      return <Knight />;
    case 'B':
      return <Bishop />;
    case 'Q':
      return <Queen />;
    case 'K':
      return <King />;
  }
}
