export default function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl lg:max-w-4xl xl:max-w-5xl p-4 text-sm leading-relaxed">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Badminton Manager – User Guide</h1>
        <p className="text-gray-600 mt-1">
          Learn the features and common use cases of this web app. This guide
          covers organizers and players (participants) with clear examples.
        </p>
      </header>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">What this app does</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Create and manage badminton sessions (date, time, number of courts,
            singles/doubles).
          </li>
          <li>
            Add players (individually or in bulk), link accounts to players, and
            assign players to courts.
          </li>
          <li>
            Run games, track scores and durations, and auto-assign players to
            keep games flowing.
          </li>
          <li>
            End a session and view statistics (leaderboard, top performers,
            usage summaries) and export JSON.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Roles</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Organizer</span>: Full control. Can
            create sessions, add players, assign courts, start/end games,
            configure auto-assign, add/remove courts, and end sessions.
          </li>
          <li>
            <span className="font-medium">Player (Participant)</span>: Join
            sessions shared with you, link your account to your player, view
            court and queue information, and see session results (limited
            controls).
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Getting started (Organizer)</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <span className="font-medium">Sign in</span> on the home page. You
            will be redirected to your Sessions list.
          </li>
          <li>
            <span className="font-medium">Create a session</span>: choose date,
            time, and number of courts.
          </li>
          <li>Open the session to manage players and courts.</li>
        </ol>
        <div className="rounded-lg border p-3 bg-gray-50">
          <div className="font-medium mb-1">Example</div>
          <div className="text-xs text-gray-700">
            You have 4 courts, playing doubles. Create the session with 4
            courts. Use Bulk Add to paste a list of players (e.g., “Alice, F” /
            “Bob, M”). Use Auto-assign to quickly fill courts, then start games.
          </div>
        </div>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Adding players</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Single add</span>: enter a name
            (optional: set gender M/F via the dropdown when available) and click
            Add.
          </li>
          <li>
            <span className="font-medium">Bulk add</span>: paste names line by
            line. You can tag gender with &quot;, M&quot; or &quot;, F&quot;.
            Example:
            <div className="rounded border p-2 mt-1 bg-white text-xs">
              Alice, F<br />
              Bob, M<br />
              Charlie, F
            </div>
          </li>
          <li>
            <span className="font-medium">Link accounts</span>: from each
            player’s menu (⋮), you can link the current signed-in account, or
            generate a claim QR for players to scan and link themselves.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Assigning players to courts</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Organizers can assign players via the dropdown in the Players list
            (or via Auto-assign).
          </li>
          <li>
            Singles/doubles modes are supported per court; capacity updates
            automatically.
          </li>
          <li>
            During a game, use the Queue panel to select who’s up next. You can
            toggle A/B to set next teams. Pairing hints appear beside the
            controls.
          </li>
        </ul>
        <div className="rounded-lg border p-3 bg-gray-50">
          <div className="font-medium mb-1">Example</div>
          <div className="text-xs text-gray-700">
            Court 2 is doubles. While it’s in progress, queue the next 4 players
            and set their A/B sides. When the game ends, you can start the next
            game immediately with those queued players.
          </div>
        </div>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Starting and ending games</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            When a court has the required players and pairs, click{" "}
            <span className="font-medium">Start game</span>.
          </li>
          <li>
            To finish, click <span className="font-medium">End game</span> and
            enter the final score.
          </li>
          <li>
            If needed, mark a game as void; voided games are excluded from
            session statistics.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Auto-assign</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Use <span className="font-medium">Auto-assign</span> to quickly fill
            courts with available players (while avoiding busy players and
            respecting court capacities).
          </li>
          <li>
            Use <span className="font-medium">Auto-assign next teams</span>{" "}
            while a game is in progress to prepare the next A/B teams.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">
          Ending the session & statistics
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Click <span className="font-medium">End session</span> (when no
            court is in progress).
          </li>
          <li>
            View the statistics card for total games, shuttles used, top
            winners/losers/scorers, most active player, best pair, longest
            duration, and most intense game.
          </li>
          <li>Export the session data to JSON.</li>
        </ul>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">
          Player (Participant) experience
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Join a session via a shared link or after scanning a claim QR to
            link your account.
          </li>
          <li>
            See which court you are on and who’s queued next (A/B sides). Your
            linked name appears bold in the queue.
          </li>
          <li>
            Non-organizers have a simplified view: no session-ending,
            auto-assign, add players, or court management.
          </li>
        </ul>
        <div className="rounded-lg border p-3 bg-gray-50">
          <div className="font-medium mb-1">Example</div>
          <div className="text-xs text-gray-700">
            You scan a QR from the organizer to link your account to “Chris”.
            After linking, you’re redirected to the session screen, where you
            can see your current court and when you’re queued next.
          </div>
        </div>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Common use cases</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium">Club nights</span>: keep all courts
            busy with Auto-assign and queues; balance singles/doubles as needed.
          </li>
          <li>
            <span className="font-medium">Casual ladders</span>: quickly
            start/stop games and use stats to track participation and
            performance.
          </li>
          <li>
            <span className="font-medium">Ad-hoc sessions</span>: create on the
            fly, bulk add players, and rotate smoothly.
          </li>
        </ul>
      </section>

      <section className="mb-10 space-y-2">
        <h2 className="text-lg font-semibold">Tips & troubleshooting</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            If you briefly see a sign-in prompt on refresh, it’s the app waiting
            for authentication. A loading screen will appear until auth is
            ready.
          </li>
          <li>
            If a participant sees “Session not found” on the first entry, try
            re-opening from the sessions list; the linked index may still be
            syncing.
          </li>
          <li>
            You can unlink your account from a player via the player menu (⋮). A
            confirmation ensures you don’t unlink by accident.
          </li>
        </ul>
      </section>
    </main>
  );
}
