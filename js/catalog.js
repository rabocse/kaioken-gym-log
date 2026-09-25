// Kaioken exercise catalog: exercise name -> muscle group, plus chart colors.
// Categories are derived from the name at render time: nothing is stored in
// the routine data, and catalog updates apply retroactively to all history.
// Unknown/custom exercise names resolve to "Other".

const GYMLOG_CATS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full Body', 'Other',
];

const GYMLOG_EX = {
  'Bench Press': 'Chest',
  'Incline Bench Press': 'Chest',
  'Decline Bench Press': 'Chest',
  'Dumbbell Bench Press': 'Chest',
  'Incline Dumbbell Press': 'Chest',
  'Machine Chest Press': 'Chest',
  'Chest Fly': 'Chest',
  'Cable Crossover': 'Chest',
  'Push-Up': 'Chest',
  'Dips': 'Chest',
  'Deadlift': 'Back',
  'Rack Pull': 'Back',
  'Barbell Row': 'Back',
  'Pendlay Row': 'Back',
  'T-Bar Row': 'Back',
  'Seal Row': 'Back',
  'Dumbbell Row': 'Back',
  'Single-Arm Dumbbell Row': 'Back',
  'Cable Row': 'Back',
  'Lat Pulldown': 'Back',
  'Close-Grip Lat Pulldown': 'Back',
  'Straight-Arm Pulldown': 'Back',
  'Pull-Up': 'Back',
  'Chin-Up': 'Back',
  'Overhead Press': 'Shoulders',
  'Push Press': 'Shoulders',
  'Arnold Press': 'Shoulders',
  'Seated Dumbbell Press': 'Shoulders',
  'Machine Shoulder Press': 'Shoulders',
  'Lateral Raise': 'Shoulders',
  'Front Raise': 'Shoulders',
  'Rear Delt Fly': 'Shoulders',
  'Upright Row': 'Shoulders',
  'Barbell Shrug': 'Shoulders',
  'Dumbbell Shrug': 'Shoulders',
  'Face Pull': 'Shoulders',
  'Biceps Curl': 'Biceps',
  'EZ-Bar Curl': 'Biceps',
  'Hammer Curl': 'Biceps',
  'Preacher Curl': 'Biceps',
  'Incline Dumbbell Curl': 'Biceps',
  'Concentration Curl': 'Biceps',
  'Cable Curl': 'Biceps',
  'Triceps Extension': 'Triceps',
  'Overhead Triceps Extension': 'Triceps',
  'Triceps Pushdown': 'Triceps',
  'Skullcrusher': 'Triceps',
  'Close-Grip Bench Press': 'Triceps',
  'Reverse Curl': 'Forearms',
  'Wrist Curl': 'Forearms',
  'Squat': 'Quads',
  'Front Squat': 'Quads',
  'Goblet Squat': 'Quads',
  'Hack Squat': 'Quads',
  'Bulgarian Split Squat': 'Quads',
  'Leg Press': 'Quads',
  'Leg Extension': 'Quads',
  'Step-Up': 'Quads',
  'Lunge': 'Quads',
  'Romanian Deadlift': 'Hamstrings',
  'Stiff-Leg Deadlift': 'Hamstrings',
  'Good Morning': 'Hamstrings',
  'Leg Curl': 'Hamstrings',
  'Nordic Curl': 'Hamstrings',
  'Hip Thrust': 'Glutes',
  'Glute Bridge': 'Glutes',
  'Calf Raise': 'Calves',
  'Seated Calf Raise': 'Calves',
  'Plank': 'Core',
  'Side Plank': 'Core',
  'Hanging Leg Raise': 'Core',
  'Hanging Knee Raise': 'Core',
  'Cable Crunch': 'Core',
  'Crunch': 'Core',
  'Russian Twist': 'Core',
  'Ab Wheel Rollout': 'Core',
  'Power Clean': 'Full Body',
  'Hang Clean': 'Full Body',
  'Clean and Jerk': 'Full Body',
  'Snatch': 'Full Body',
  "Farmer's Walk": 'Full Body',
};

const GYMLOG_EX_LOWER = {};
Object.keys(GYMLOG_EX).forEach((k) => {
  GYMLOG_EX_LOWER[k.toLowerCase()] = GYMLOG_EX[k];
});

// All catalog exercise names, in catalog order, for autocomplete suggestions.
const GYMLOG_EX_NAMES = Object.keys(GYMLOG_EX);

function gymlogCategoryOf(name) {
  const n = String(name || '').trim().toLowerCase();
  return GYMLOG_EX_LOWER[n] || 'Other';
}

const GYMLOG_CAT_COLORS = {
  Chest: '#f87171',
  Back: '#60a5fa',
  Shoulders: '#fbbf24',
  Biceps: '#a78bfa',
  Triceps: '#f472b6',
  Forearms: '#94a3b8',
  Quads: '#34d399',
  Hamstrings: '#2dd4bf',
  Glutes: '#fb923c',
  Calves: '#e879f9',
  Core: '#a3e635',
  'Full Body': '#38bdf8',
  Other: '#64748b',
};
