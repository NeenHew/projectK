export const DEFAULT_QUESTION_DURATION_S = 15;

// Keep this small: host sends only current question (index) in room state.
export const QUESTIONS = [
  {
    text: "Which language runs in a web browser?",
    choices: ["Java", "C", "Python", "JavaScript"],
    correct: 3, // 0..3
  },
  {
    text: "What does CSS stand for?",
    choices: [
      "Computer Style Sheets",
      "Cascading Style Sheets",
      "Creative Style System",
      "Colorful Style Sheets",
    ],
    correct: 1,
  },
  {
    text: "Firebase Realtime Database is primarily…",
    choices: ["SQL", "NoSQL JSON tree", "Graph database", "File storage"],
    correct: 1,
  },
  {
    text: "HTTP status 404 means…",
    choices: ["OK", "Unauthorized", "Not Found", "Server Error"],
    correct: 2,
  },
  {
    text: "Which is a JavaScript framework?",
    choices: ["Django", "Laravel", "React", "Rails"],
    correct: 2,
  },
];

