"use client";

type FaqItem = {
  question: string;
  answer: string;
};

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

export default function FaqContent() {
  return (
    <section>
      <h2 className="text-xl font-semibold">FAQ</h2>
      <p className="mt-1 text-gray-600">Answers to common questions.</p>
      <div className="mt-4 space-y-4">
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
      </div>
    </section>
  );
}
