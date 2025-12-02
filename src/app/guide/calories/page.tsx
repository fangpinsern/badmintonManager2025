import Link from "next/link";

export default function CaloriesGuidePage() {
  return (
    <main className="mx-auto max-w-3xl p-4 text-sm leading-relaxed">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">How we estimate calories</h1>
        <p className="text-gray-600 mt-1">
          We provide a simple per–player calorie estimate for each game you
          participate in, then sum it up in the session stats.
        </p>
      </header>

      <section className="mb-6 space-y-2">
        <h2 className="text-lg font-semibold">The formula</h2>
        <p>
          We use a standard MET-based estimate commonly used in fitness apps:
        </p>
        <div className="rounded-lg border bg-gray-50 p-3 text-xs text-gray-700">
          kcal per minute = (MET × 3.5 × body weight in kg) / 200
        </div>
        <p className="text-gray-700">
          We assume a{" "}
          <span className="font-medium">70&nbsp;kg body weight</span> for all
          players, so results are a rough ballpark and will vary by person.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-lg font-semibold">What is a MET-based estimate?</h2>
        <p>
          <span className="font-medium">MET</span> stands for{" "}
          <span className="font-medium">Metabolic Equivalent of Task</span>. It
          indicates how much energy an activity uses compared to resting.{" "}
          1&nbsp;MET is roughly the energy used at rest (about 3.5&nbsp;ml
          O₂/kg/min). Higher METs mean higher intensity and greater energy use.
        </p>
        <p className="text-gray-700">
          Using MET values lets us turn activity intensity and duration into a
          rough calorie estimate, without needing heart‑rate data.
        </p>
        <p className="text-gray-700">
          For background, see:{" "}
          <a
            href="https://en.wikipedia.org/wiki/Metabolic_equivalent_of_task"
            target="_blank"
            rel="noreferrer"
            className="text-sky-700 hover:underline"
          >
            Metabolic equivalent of task (Wikipedia)
          </a>{" "}
          for more details.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-lg font-semibold">Intensity levels</h2>
        <p>
          When ending a game, you can set its intensity. We map intensities to
          approximate MET values:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border text-left">
            <thead className="bg-gray-50 text-xs text-gray-700">
              <tr>
                <th className="border px-3 py-2">Intensity</th>
                <th className="border px-3 py-2">Approx. MET</th>
                <th className="border px-3 py-2">Typical indicators</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="align-top">
                <td className="border px-3 py-2 font-medium">Low</td>
                <td className="border px-3 py-2">~6</td>
                <td className="border px-3 py-2">
                  <ul className="list-disc pl-5 text-gray-700 space-y-1">
                    <li>Breathing fast but comfortable; full sentences</li>
                    <li>Light sweat; effort feels easy to steady</li>
                    <li>Can still walk around and go for a cup of coffee</li>
                  </ul>
                </td>
              </tr>
              <tr className="align-top">
                <td className="border px-3 py-2 font-medium">Mid</td>
                <td className="border px-3 py-2">~8.5</td>
                <td className="border px-3 py-2">
                  <ul className="list-disc pl-5 text-gray-700 space-y-1">
                    <li>Breathing noticeably heavier; short phrases</li>
                    <li>Moderate sweat; sustained purposeful effort</li>
                    <li>Need to sit down</li>
                  </ul>
                </td>
              </tr>
              <tr className="align-top">
                <td className="border px-3 py-2 font-medium">High</td>
                <td className="border px-3 py-2">~11</td>
                <td className="border px-3 py-2">
                  <ul className="list-disc pl-5 text-gray-700 space-y-1">
                    <li>Breathing hard; words instead of sentences</li>
                    <li>Heavy sweat; effort feels intense and taxing</li>
                    <li>Need to lie down</li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-lg font-semibold">Duration we use</h2>
        <p>
          If the game duration is known, we use it directly. If not, we assume a
          short default duration of{" "}
          <span className="font-medium">15 minutes</span> to avoid showing zero.
        </p>
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-lg font-semibold">Per player and session total</h2>
        <p>
          The estimate is calculated{" "}
          <span className="font-medium">per player</span> for each game. In the
          session stats, we{" "}
          <span className="font-medium">sum your per‑game estimates</span>{" "}
          across all non‑voided games you participated in.
        </p>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Notes and limitations</h2>
        <ul className="list-disc pl-5">
          <li>
            Using a fixed 70&nbsp;kg body weight means values are approximate
            and not medical advice.
          </li>
          <li>
            Technique, intensity, and actual time-on-court can vary
            significantly between players and sessions.
          </li>
          <li>
            Voided games are excluded from all statistics and calorie totals.
          </li>
        </ul>
      </section>

      <div className="mt-10">
        <Link
          href="/"
          className="inline-block rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
