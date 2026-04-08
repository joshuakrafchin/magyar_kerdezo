// Mirror of the client-side curriculum for server-side use
const LEVELS = ['A1', 'A2', 'B1', 'B2'];

const TOPICS = {
  A1: [
    'greetings and introductions', 'name, age, and nationality',
    'family members', 'numbers and counting', 'days and months',
    'food and drink', 'colors and clothes', 'directions and places',
    'weather', 'telling time', 'basic shopping',
  ],
  A2: [
    'daily routines', 'hobbies and free time', 'travel and transport',
    'health and body', 'past tense conversations', 'future plans',
    'comparisons', 'emotions and feelings', 'describing people and places',
    'phone conversations',
  ],
  B1: [
    'work and career', 'education system', 'news and current events',
    'expressing opinions', 'conditional situations', 'Hungarian culture and traditions',
    'formal vs informal register', 'complaints and requests', 'storytelling',
    'environment and nature',
  ],
  B2: [
    'abstract discussion', 'debate and persuasion', 'Hungarian idioms and expressions',
    'humor and wordplay', 'professional Hungarian', 'literature and arts',
    'politics and society', 'complex conditional and subjunctive', 'nuance and subtlety',
    'formal exam preparation',
  ],
};

const QUESTIONS_PER_LEVEL = { A1: 20, A2: 15, B1: 10, B2: 5 };

module.exports = { LEVELS, TOPICS, QUESTIONS_PER_LEVEL };
