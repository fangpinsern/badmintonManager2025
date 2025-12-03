"use client";

type FaqItem = {
  question: string;
  answer: string;
};

const ratingItems: FaqItem[] = [
  {
    question: "How do I get a rating?",
    answer:
      "Just join a session and play real games. When the organizer ends the session, your results are processed and your rating updates automatically. Guests influence expectations but only linked accounts receive stored ratings.",
  },
  {
    question: "How are ratings calculated?",
    answer:
      "We use an Elo‑style model. Before a match, we estimate each side’s win probability from current ratings. After the match, ratings move up or down based on result vs expectation, with bigger moves for new players and smaller moves as you gain more matches.",
  },
  {
    question: "What do different ratings mean?",
    answer:
      "Ratings are centered around 1500. Higher means stronger. 1200‑1400: beginner/early improver; 1400‑1600: developing/club regular; 1600‑1800: advanced/strong club; 1800+: highly competitive. Singles and Doubles are separate.",
  },
];

const faqItems: FaqItem[] = [
  {
    question: "How do I create a session?",
    answer:
      "Go to the home page and use the Create session form. Set date/time and number of courts, then click Create.",
  },
  {
    question: "How do I link my profile to a player?",
    answer:
      "Ask the organizer to share a claim link for the player representing you. Open it and sign in/register; your account will be linked to that player in the session.",
  },
  {
    question:
      "Why can't I just add a player by username to a session and require them to link their account instead?",
    answer:
      "This was an explicit design decision to prevent inaccuracies. The performance of the player in session is tied to the statistics of the linked profile. \nWe want to avoid a case where someone just adds another player to the session and play fake games to bring down other players' stats. Hence we believe adding this linking measure will reduce the chance of that happening.",
  },
  {
    question: "What is the limit on courts per session?",
    answer:
      "Sessions support up to 10 courts. You cannot create or add more than 10 courts.",
  },
];

export default function FaqContent({
  includeRatings = false,
}: {
  includeRatings?: boolean;
}) {
  return (
    <section>
      <div className="mt-4 space-y-4">
        <>
          <h2 className="text-base font-semibold">General</h2>
          {faqItems.map((item) => (
            <details className="rounded-lg border p-4" key={item.question}>
              <summary className="cursor-pointer font-medium">
                {item.question}
              </summary>
              {item.answer.split("\n").map((line) => (
                <p key={line} className="mt-2 text-gray-700">
                  {line}
                </p>
              ))}
            </details>
          ))}
          <hr className="my-2" />
        </>

        {includeRatings && (
          <>
            <h2 className="text-base font-semibold">Player Ratings</h2>
            {ratingItems.map((item) => (
              <details className="rounded-lg border p-4" key={item.question}>
                <summary className="cursor-pointer font-medium">
                  {item.question}
                </summary>
                {item.answer.split("\n").map((line) => (
                  <p key={line} className="mt-2 text-gray-700">
                    {line}
                  </p>
                ))}
              </details>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
