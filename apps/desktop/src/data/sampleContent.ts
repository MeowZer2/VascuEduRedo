import type { Category, VascCase } from '../types';

export const categories: Category[] = [
  {
    id: 'aaa',
    title: 'Abdominal Aortic Aneurysm',
    emoji: '🫀',
    description: 'CTA interpretation, rupture risk, EVAR planning, and postoperative surveillance.',
    color: 'rose',
  },
  {
    id: 'carotid',
    title: 'Carotid Disease',
    emoji: '🧠',
    description: 'Symptomatic stenosis, imaging review, indications, and operative decision-making.',
    color: 'indigo',
  },
  {
    id: 'dialysis-access',
    title: 'Dialysis Access',
    emoji: '💉',
    description: 'Access planning, fistula complications, steal syndrome, and surveillance.',
    color: 'emerald',
  },
];

export const cases: VascCase[] = [
  {
    id: 'aaa-001',
    categoryId: 'aaa',
    title: 'Large infrarenal AAA with suitable proximal neck',
    diagnosis: 'Asymptomatic infrarenal abdominal aortic aneurysm',
    difficulty: 'intermediate',
    estimatedMinutes: 12,
    tags: ['AAA', 'EVAR', 'CTA', 'aneurysm neck', 'iliac access'],
    patient: {
      age: 73,
      sex: 'male',
      presentation: 'Incidental 6.1 cm infrarenal AAA found during workup for abdominal discomfort.',
      history: ['Hypertension', 'Former smoker', 'Coronary artery disease', 'eGFR 64 mL/min/1.73m²'],
      vitals: ['HR 78', 'BP 138/74', 'Afebrile', 'Hemodynamically stable'],
    },
    learningObjectives: [
      'Identify key CTA measurements required before EVAR.',
      'Recognize an adequate infrarenal neck for standard EVAR.',
      'Choose appropriate first-line management for an asymptomatic large AAA.',
      'Understand why iliac access matters before endograft delivery.',
    ],
    volume: {
      type: 'nrrd',
      path: 'content/aaa/volumes/sample-aaa-001.nrrd',
      description: 'Synthetic NRRD CTA volume loaded by the Rust/Tauri backend for the axial viewer spike.',
    },
    questions: [
      {
        id: 'q1',
        type: 'multipleChoice',
        prompt: 'What is the most appropriate next management step for this stable patient with a 6.1 cm infrarenal AAA?',
        choices: [
          { id: 'a', label: 'Discharge with repeat ultrasound in 3 years' },
          { id: 'b', label: 'Elective aneurysm repair planning after anatomic assessment' },
          { id: 'c', label: 'Immediate thrombolysis' },
          { id: 'd', label: 'No vascular follow-up is required' },
        ],
        correctChoiceId: 'b',
        points: 2,
        hints: ['Think about size threshold.', 'A 6.1 cm AAA in a fit patient usually needs repair planning.'],
        explanation: 'A 6.1 cm infrarenal AAA generally meets criteria for elective repair planning if the patient is an acceptable operative candidate. CTA anatomy determines EVAR suitability.',
      },
      {
        id: 'q2',
        type: 'multiSelect',
        prompt: 'Which measurements are important before planning standard EVAR? Select all that apply.',
        choices: [
          { id: 'neck_diameter', label: 'Proximal neck diameter' },
          { id: 'neck_length', label: 'Proximal neck length' },
          { id: 'iliac_access', label: 'Iliac access diameter and tortuosity' },
          { id: 'shoe_size', label: 'Patient shoe size' },
        ],
        correctChoiceIds: ['neck_diameter', 'neck_length', 'iliac_access'],
        points: 3,
        hints: ['Think device seal and delivery.', 'The neck and access vessels are critical.'],
        explanation: 'EVAR planning requires proximal seal measurements and access assessment, including neck diameter, neck length, angulation, iliac diameters, calcification, and tortuosity.',
      },
      {
        id: 'q3',
        type: 'trueFalse',
        prompt: 'A short, severely angulated, thrombus-lined proximal neck may increase the risk of type Ia endoleak after EVAR.',
        correct: true,
        points: 1,
        hints: ['Think proximal seal failure.'],
        explanation: 'Poor neck morphology can compromise proximal seal and fixation, increasing the risk of type Ia endoleak or migration.',
      },
      {
        id: 'q4',
        type: 'numeric',
        prompt: 'For this sample case, enter the approximate maximal aneurysm diameter in cm.',
        correctValue: 6.1,
        tolerance: 0.4,
        unit: 'cm',
        points: 2,
        hints: ['The value is in the clinical stem.', 'Use cm, not mm.'],
        explanation: 'The case stem describes a 6.1 cm aneurysm. In real CTA workflow, maximal diameter should be measured perpendicular to the vessel centerline when possible.',
      },
      {
        id: 'q5',
        type: 'shortText',
        prompt: 'Name one major complication that CTA surveillance after EVAR is looking for.',
        requiredKeywords: ['endoleak', 'migration', 'sac enlargement'],
        points: 2,
        hints: ['Think persistent sac pressurization.', 'One answer is endoleak.'],
        explanation: 'Surveillance looks for complications such as endoleak, graft migration, limb occlusion, kinking, infection, and aneurysm sac enlargement.',
      },
      {
        id: 'q6',
        type: 'measurement',
        prompt: 'Using the viewer, measure the maximal transverse diameter of the aortic aneurysm on the axial plane.',
        target: 'maximal aneurysm transverse diameter',
        plane: 'axial',
        correctValue: 61,
        tolerance: 8,
        unit: 'mm',
        points: 3,
        hints: [
          'Switch to the Axial plane and select the Distance tool.',
          'Place the two endpoints at the outer walls of the aortic lumen at its widest point.',
        ],
        explanation:
          'The maximal transverse diameter on axial CTA is a key EVAR planning measurement. The synthetic NRRD volume in this case represents an approximately 61 mm AAA. Measurements within ±8 mm are accepted to account for section choice and caliper placement variation.',
      },
      {
        id: 'q7',
        type: 'deviceSelection',
        prompt:
          'Given suitable infrarenal anatomy and standard EVAR planning, which device class is the most appropriate first-line choice for this AAA?',
        allowedCategory: 'aortic endograft',
        correctDeviceId: 'dev-eg-gore-excluder',
        points: 2,
        hints: ['Think first-line endovascular AAA repair.', 'Bifurcated infrarenal endograft.'],
        explanation:
          'Standard infrarenal AAAs with adequate proximal neck and iliac access are typically treated with a bifurcated infrarenal aortic endograft.',
      },
    ],
  },
  {
    id: 'carotid-001',
    categoryId: 'carotid',
    title: 'Symptomatic high-grade internal carotid artery stenosis',
    diagnosis: 'Symptomatic carotid stenosis',
    difficulty: 'advanced',
    estimatedMinutes: 10,
    tags: ['Carotid', 'TIA', 'CEA', 'CTA'],
    patient: {
      age: 68,
      sex: 'female',
      presentation: 'Transient right arm weakness and aphasia lasting 20 minutes, now resolved.',
      history: ['Diabetes', 'Hypertension', 'Hyperlipidemia'],
    },
    learningObjectives: [
      'Recognize symptomatic carotid stenosis.',
      'Identify key timing considerations for intervention.',
      'Review medical therapy priorities.',
    ],
    volume: {
      type: 'nrrd',
      path: 'content/aaa/volumes/sample-aaa-001.nrrd',
      description: 'Uses the bundled sample NRRD volume until carotid-specific imaging content is added.',
    },
    questions: [
      {
        id: 'q1',
        type: 'multipleChoice',
        prompt: 'This patient is best described as having which clinical syndrome?',
        choices: [
          { id: 'a', label: 'Asymptomatic carotid stenosis' },
          { id: 'b', label: 'Symptomatic carotid stenosis after TIA' },
          { id: 'c', label: 'Acute limb ischemia' },
          { id: 'd', label: 'Chronic mesenteric ischemia' },
        ],
        correctChoiceId: 'b',
        points: 2,
        explanation: 'A transient focal neurologic deficit in a carotid distribution makes the stenosis symptomatic.',
      },
    ],
  },
];

export function getCaseById(caseId: string): VascCase | undefined {
  return cases.find((c) => c.id === caseId);
}

export function getCategoryById(categoryId: string): Category | undefined {
  return categories.find((c) => c.id === categoryId);
}
