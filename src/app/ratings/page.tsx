"use client";

import Link from "next/link";
import MathBlock from "@/components/MathBlock";

export default function RatingsExplainerPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 text-sm">
      <h1 className="text-2xl font-semibold">How ratings work</h1>
      <p className="mt-1 text-gray-600">
        A quick, plain‑English guide to our Elo‑style player ratings. This page
        reflects what&apos;s implemented today.
      </p>

      <section className="mt-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold">What a rating is</h2>
          <p className="mt-2 text-gray-700">
            Ratings are centered around 1500. Higher means stronger. We keep
            separate ratings for <strong>Doubles</strong> and{" "}
            <strong>Singles</strong>.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold">What ratings mean</h2>
          <p className="mt-2 text-gray-700">
            These ranges are an approximate guide to player skill. Actual
            strength varies by opponents and experience.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border">
            <div className="grid grid-cols-4 text-center text-[11px] font-medium text-gray-800">
              <div className="bg-blue-100 px-2 py-3">
                <div className="text-xs">1200–1400</div>
                <div>Beginner</div>
              </div>
              <div className="bg-cyan-100 px-2 py-3">
                <div className="text-xs">1400–1600</div>
                <div>Mid</div>
              </div>
              <div className="bg-emerald-100 px-2 py-3">
                <div className="text-xs">1600–1800</div>
                <div>Intermediate</div>
              </div>
              <div className="bg-amber-100 px-2 py-3">
                <div className="text-xs">1800+</div>
                <div>Advanced</div>
              </div>
            </div>
            <div className="flex justify-between border-t bg-white px-3 py-1 text-[10px] text-gray-500">
              <span>~1200</span>
              <span className="px-6">1400</span>
              <span className="px-6">1600</span>
              <span className="px-6">1800</span>
              <span>2000+</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            Singles and Doubles ratings are separate. Labels are indicative, not
            tiers or ranks.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold">When updates happen</h2>
          <p className="mt-2 text-gray-700">
            Your rating updates automatically when an organizer ends a session.
            Games played during the session are processed together in the
            background.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold">How a game affects rating</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-gray-700">
            <li>
              <strong>Expected win probability</strong>: Before a match, we
              compute each side&apos;s win chance from current ratings using a
              standard Elo logistic curve.
            </li>
            <li>
              <strong>Result vs expectation</strong>: After the match, ratings
              move up if you did better than expected, and down if worse.
            </li>
            <li>
              <strong>Experience matters (K‑factor)</strong>: Newer players move
              more; movement decreases as you accumulate matches. Your rating
              generally stabilizes after ~20 matches in that mode. We also show
              a <em>Provisional</em> label until you have roughly 10 matches.
            </li>
            <li>
              <strong>Margin of victory (MOV) is capped</strong>: Score
              difference provides a small multiplier, but we cap it so blowouts
              don&apos;t dominate changes.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-semibold">Trust and linked accounts</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-gray-700">
            <li>
              Only <strong>linked accounts</strong> receive stored rating
              updates. Guests influence expectations, but do not get a stored
              rating.
            </li>
            <li>
              The <strong>more linked players</strong> participating in a match,
              the more weight we give that result. Matches with zero linked
              players are ignored for ratings.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-semibold">Doubles specifics</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-gray-700">
            <li>
              Team strength is the <strong>sum of partner ratings</strong>.
            </li>
            <li>
              When <strong>both partners are linked</strong>, we apply a small{" "}
              <strong>partner chemistry</strong> adjustment that can learn over
              time and gently decays with inactivity. Chemistry does not apply
              to guest pairs.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-semibold">Math Details</h2>
          <p className="mt-2 text-gray-700">
            We use an Elo‑style update. For each match, we compute expected win
            probability, then apply a bounded update scaled by experience, trust
            and score margin:
          </p>
          <div className="mt-2 rounded-lg border bg-gray-50 p-3 overflow-x-auto">
            <div className="text-[12px] font-medium text-gray-800">
              Expected win (team A)
            </div>
            <MathBlock
              latex={`E_A = \\frac{1}{1 + 10^{\\frac{T_B - T_A}{400}}}`}
              className="mt-1 text-[12px]"
            />
            <div className="mt-3 text-[12px] font-medium text-gray-800">
              Team strength (Singles)
            </div>
            <MathBlock latex={`T_A = R_A`} className="mt-1 text-[12px]" />
            <div className="mt-3 text-[12px] font-medium text-gray-800">
              Team strength (Doubles)
            </div>
            <MathBlock
              latex={`T_A = R_{A1} + R_{A2} + \\delta_{\\mathrm{chem}}(A)`}
              className="mt-1 text-[12px]"
            />
            <div className="mt-1 text-[11px] text-gray-600">
              δ<sub>chem</sub> applies only when both partners are linked.
            </div>
            <div className="mt-3 text-[12px] font-medium text-gray-800">
              Rating update (team i ∈ {`{A, B}`})
            </div>
            <MathBlock
              latex={`\\Delta R_i = K_{\\mathrm{eff}}\\,\\cdot\\, w_{\\mathrm{trust}}\\,\\cdot\\, f_{\\mathrm{mov}}\\,\\cdot\\,(S_i - E_i)`}
              className="mt-1 text-[12px]"
            />
            <div className="mt-3 text-[12px] font-medium text-gray-800">
              Where
            </div>
            <MathBlock
              latex={`K_{\\mathrm{eff}} = \\tfrac{K_A + K_B}{2}`}
              className="mt-1 text-[12px]"
            />
            <MathBlock
              latex={`f_{\\mathrm{mov}} = \\min\\bigl(1.2,\\; \\ln\\bigl(1 + \\tfrac{|\\mathrm{points}_A - \\mathrm{points}_B|}{8}\\bigr)\\bigr)`}
              className="mt-1 text-[12px]"
            />
            <div className="mt-1 text-[11px] text-gray-600">
              If points are unknown, use f<sub>mov</sub> = 1.0.
            </div>
          </div>
          <div className="mt-3 rounded-lg border bg-white p-3">
            <div className="text-[12px] font-medium text-gray-800">
              Symbols and legends
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-gray-700">
              <li>
                <strong>R</strong>: player rating (per‑mode; Singles or Doubles)
              </li>
              <li>
                <strong>T</strong>
                <sub>A</sub>, <strong>T</strong>
                <sub>B</sub>: team strengths used to compute expectation (sum of
                player ratings; in Doubles includes δ<sub>chem</sub> when both
                partners are linked)
              </li>
              <li>
                <strong>E</strong>
                <sub>i</sub>: expected score for team i from the Elo logistic
                with τ = 400
              </li>
              <li>
                <strong>S</strong>
                <sub>i</sub>: actual score (win=1, loss=0) for team i
              </li>
              <li>
                <strong>K</strong>
                <sub>A</sub>, <strong>K</strong>
                <sub>B</sub>: per‑team average K based on players’ experience;
                movement decreases after more matches (stabilizes around ~20)
              </li>
              <li>
                <strong>w</strong>
                <sub>trust</sub>: weight by linked composition:
                <div className="mt-1 ml-3">
                  <div className="text-[11px]">• 4 linked players: 1.00</div>
                  <div className="text-[11px]">
                    • 2–3 linked players (both sides linked): 0.75
                  </div>
                  <div className="text-[11px]">• exactly 1 linked: 0.25</div>
                  <div className="text-[11px]">• 0 linked: ignored</div>
                </div>
              </li>
              <li>
                <strong>f</strong>
                <sub>mov</sub>: capped margin‑of‑victory multiplier (at most
                1.2)
              </li>
              <li>
                δ<sub>chem</sub>: small partner chemistry adjustment (for
                Doubles, linked–linked pairs only); gently decays with
                inactivity
              </li>
            </ul>
          </div>
        </div>
        <div className="rounded-lg border bg-gray-50 p-4 text-gray-700">
          <div className="font-medium">Quick notes</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Singles and Doubles ratings are independent.</li>
            <li>Only matches with linked players affect stored ratings.</li>
            <li>
              Movement reflects result vs expectation, scaled by experience and
              a capped margin‑of‑victory factor.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border bg-white p-4 text-gray-700">
          <h2 className="text-base font-semibold">Model versions</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left font-medium text-gray-700">
                    Version
                  </th>
                  <th className="p-2 text-left font-medium text-gray-700">
                    Release date
                  </th>
                  <th className="p-2 text-left font-medium text-gray-700">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-2">v0.1</td>
                  <td className="p-2">2025-12-03</td>
                  <td className="p-2">Initial version</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="pt-2">
          <Link href="/profile" className="rounded border px-3 py-1.5 text-xs">
            ← Back to profile
          </Link>
        </div>
      </section>
    </main>
  );
}
