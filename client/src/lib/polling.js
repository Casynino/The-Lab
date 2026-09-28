/*
  HOW OFTEN A SCREEN MAY ASK THE SERVER AGAIN.

  The whole company works behind one connection, so the host counts every tab
  on every desk and every rep's phone as a single address. Vercel's firewall
  watches that count and, when it climbs, challenges the address for ten
  minutes at a time — and a challenge is a page a BROWSER can answer, not a
  request the app makes in the background. Those come back 403 with nothing in
  them, which is how a sale of TSh 464,500 came back "failed" with the customer
  still standing there.

  Seventeen screens each asking every thirty seconds is what took us over the
  line. So screens ask rarely, and ask straight away when somebody actually
  looks at them (refetchOnWindowFocus) — which is when it matters and costs one
  request instead of a hundred and twenty.
*/

// Things people sit and watch change: approvals waiting, the activity feed.
export const LIVE = 60_000;

// The day's figures. A minute-old number never changed a decision.
export const STEADY = 120_000;

// Lists that barely move: settings, a rep's own profile.
export const SLOW = 300_000;
