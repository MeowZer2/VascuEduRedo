// Central learner image mapping.
//
// Image files live in src/assets/learner/. They are discovered at build time
// via import.meta.glob so the app keeps building even if files are not yet on
// disk — missing assets resolve to `undefined` and consumers fall back to
// existing category backgrounds or a plain surface.

import { getCategoryBackground } from '../features/cases/categoryBackgrounds';
import type { VascCase } from '../types';

const learnerAssets = import.meta.glob<string>('../assets/learner/*.png', {
  eager: true,
  import: 'default',
});

function asset(filename: string): string | undefined {
  return learnerAssets[`../assets/learner/${filename}`];
}

// Source-of-truth filenames. Each constant is checked against several
// candidate filenames so the map works whether the user kept the descriptive
// names or the shorter `imageN.png` names that ship with the asset bundle.
//
// Subject mapping was derived from a visual inspection of the supplied PNGs;
// reassign individual slots here if you re-shoot or rename an asset.
const FILE = {
  homeHeroVascEdu: pickFile(['home-hero-vascedu.png']),
  homeTileCases: pickFile(['home-tile-cases.png']),
  homeTilePlanning: pickFile(['home-tile-planning.png']),
  homeTileDevices: pickFile(['home-tile-devices.png']),
  homeTileProgress: pickFile(['home-tile-progress.png']),
  homeContinueCase: pickFile(['home-continue-case.png']),
  casesHeroPractice: pickFile(['cases-hero-practice.png']),
  casesActionGuidedPractice: pickFile(['cases-action-guided-practice.png']),
  casesActionRandomCase: pickFile(['cases-action-random-case.png']),
  casesActionWithPlans: pickFile(['cases-action-with-plans.png']),
  casesTopicAllTopics: pickFile(['cases-topic-all-topics.png']),
  topicAaa: pickFile(['topic-aaa.png']),
  topicCerebrovascular: pickFile(['topic-cerebrovascular.png']),
  topicMesentericRenal: pickFile(['topic-mesenteric-renal.png']),
  topicPad: pickFile(['topic-peripheral-arterial-disease.png']),
  topicVenous: pickFile(['topic-venous.png']),
  topicDialysisAccess: pickFile(['topic-dialysis-access.png']),
  topicThoracic: pickFile(['topic-thoracic-aorta-arch.png']),
  trainingHeroGuidedPractice: pickFile(['training-hero-guided-practice.png']),
  trainingFocusAaa: pickFile(['training-focus-aaa.png']),
  trainingFocusCerebrovascular: pickFile(['training-focus-cerebrovascular.png']),
  trainingFocusDialysisAccess: pickFile(['training-focus-dialysis-access.png']),
  trainingFocusMesentericRenal: pickFile(['training-focus-mesenteric-renal.png']),
  trainingFocusPad: pickFile(['training-focus-pad.png']),
  genericBannerHero: pickFile(['generic-banner-hero.png']),
  genericBannerWide: pickFile(['generic-banner-wide.png']),
  genericBannerMedium: pickFile(['generic-banner-medium.png']),
  genericTopicCard: pickFile(['generic-topic-card.png']),
  genericCaseTile: pickFile(['generic-case-tile.png']),
  genericCompactTopicBackground: pickFile(['generic-compact-topic-background.png']),
  // image1.png — silhouette + vascular tree + caliper (broad hero)
  vascularAnatomyTech: pickFile([
    'vascular_anatomy_and_medical_technology_scene.png',
    'image1.png',
  ]),
  // iamge2.png — catheter PICC line through chest (also used as cases hero)
  futuristicInterface: pickFile([
    'futuristic_vascular_interface_design.png',
    'iamge2.png',
    'image2.png',
  ]),
  // image3.png — vascular branches with imaging panels (UI / measurement)
  measurementUi: pickFile([
    'tech_style_vascular_measurement_ui_design.png',
    'image3.png',
  ]),
  // image4.png — caliper close-up around vessel (precision)
  clinicalPrecision: pickFile([
    'clinical_precision_in_medical_design.png',
    'image4.png',
  ]),
  // image5.png — catheter / balloon / stent line-up (devices)
  angiogramStent: pickFile([
    'angiogram_with_stent_device_and_anatomy.png',
    'image5.png',
  ]),
  // image6.png — stent at iliac/renal origin (imaging+planning)
  futuristicAngiography: pickFile([
    'futuristic_vascular_imaging_and_angiography_scene.png',
    'image6.png',
  ]),
  // image7.png — AAA + kidneys + endograft view (vascular detail / dialysis aux)
  vascularDetail: pickFile([
    'anatomical_medical_illustration_with_vascular_deta.png',
    'image7.png',
  ]),
  // image10.png — carotid bifurcation close-up (carotid stenosis)
  carotidStenosis: pickFile([
    'anatomical_visualization_of_carotid_artery_stenosi.png',
    'image10.png',
  ]),
  // image8.png — AAA bulb + carotid bifurcation (general scan / measurement)
  vascularMeasurement: pickFile([
    'vascular_scan_with_measuring_tool_detail.png',
    'image8.png',
  ]),
  // image9.png — AAA close-up (aneurysm)
  aneurysmCloseUp: pickFile([
    'anatomical_aneurysm_close_up_illustration.png',
    'image9.png',
  ]),
} as const;

function pickFile(candidates: string[]): string {
  // Returns the first candidate the bundler resolved. If none resolve we
  // return the canonical name so the lookup just yields `undefined` and the
  // UI falls back to its no-image style.
  for (const name of candidates) {
    if (learnerAssets[`../assets/learner/${name}`]) return name;
  }
  return candidates[0];
}

export type LearnerHeroSlot =
  | 'home'
  | 'cases'
  | 'planning'
  | 'devices'
  | 'progress';

export const heroBackgrounds: Record<LearnerHeroSlot, string | undefined> = {
  home: asset(FILE.homeHeroVascEdu) ?? asset(FILE.futuristicInterface),
  cases: asset(FILE.casesHeroPractice) ?? asset(FILE.futuristicAngiography),
  planning: asset(FILE.angiogramStent),
  devices: asset(FILE.clinicalPrecision),
  progress: asset(FILE.measurementUi),
};

// Topic artwork. Multiple aliases map to the same image so legacy categoryIds
// keep working.
const topicArt: Record<string, string | undefined> = {
  aaa: asset(FILE.topicAaa) ?? asset(FILE.aneurysmCloseUp) ?? asset(FILE.vascularAnatomyTech),
  aneurysm: asset(FILE.topicAaa) ?? asset(FILE.aneurysmCloseUp) ?? asset(FILE.vascularAnatomyTech),
  cerebrovascular: asset(FILE.topicCerebrovascular) ?? asset(FILE.carotidStenosis),
  carotid: asset(FILE.topicCerebrovascular) ?? asset(FILE.carotidStenosis),
  'mesenteric-renal': asset(FILE.topicMesentericRenal) ?? asset(FILE.vascularAnatomyTech),
  'mesenteric-ischemia': asset(FILE.topicMesentericRenal) ?? asset(FILE.vascularAnatomyTech),
  mesenteric: asset(FILE.topicMesentericRenal) ?? asset(FILE.vascularAnatomyTech),
  pad: asset(FILE.topicPad) ?? asset(FILE.angiogramStent),
  'peripheral-arterial-disease': asset(FILE.topicPad) ?? asset(FILE.angiogramStent),
  venous: asset(FILE.topicVenous) ?? asset(FILE.vascularMeasurement),
  'dialysis-access': asset(FILE.topicDialysisAccess) ?? asset(FILE.vascularDetail),
  dialysis: asset(FILE.topicDialysisAccess) ?? asset(FILE.vascularDetail),
  thoracic: asset(FILE.topicThoracic) ?? asset(FILE.futuristicAngiography),
};

export type FeatureSlot =
  | 'measurement'
  | 'devices'
  | 'planning'
  | 'imaging'
  | 'overview';

export const featureArt: Record<FeatureSlot, string | undefined> = {
  measurement: asset(FILE.vascularMeasurement) ?? asset(FILE.measurementUi),
  devices: asset(FILE.angiogramStent) ?? asset(FILE.clinicalPrecision),
  planning: asset(FILE.clinicalPrecision) ?? asset(FILE.angiogramStent),
  imaging: asset(FILE.futuristicAngiography) ?? asset(FILE.measurementUi),
  overview: asset(FILE.futuristicInterface) ?? asset(FILE.vascularAnatomyTech),
};

export type ActionSlot = 'practice' | 'cases' | 'planning' | 'devices' | 'progress';

export const actionArt: Record<ActionSlot, string | undefined> = {
  practice: asset(FILE.measurementUi) ?? asset(FILE.vascularMeasurement),
  cases: asset(FILE.homeTileCases) ?? asset(FILE.futuristicAngiography),
  planning: asset(FILE.homeTilePlanning) ?? asset(FILE.clinicalPrecision),
  devices: asset(FILE.homeTileDevices) ?? asset(FILE.angiogramStent),
  progress: asset(FILE.homeTileProgress) ?? asset(FILE.measurementUi),
};

export const homeContinueArt = asset(FILE.homeContinueCase) ?? asset(FILE.aneurysmCloseUp);

export const casesPracticeArt = {
  guided: asset(FILE.casesActionGuidedPractice) ?? actionArt.practice,
  random: asset(FILE.casesActionRandomCase) ?? actionArt.cases,
  plans: asset(FILE.casesActionWithPlans) ?? actionArt.planning,
  allTopics: asset(FILE.casesTopicAllTopics) ?? featureArt.overview,
};

export const trainingArt = {
  hero: asset(FILE.trainingHeroGuidedPractice) ?? featureArt.imaging,
  focusTopics: {
    aaa: asset(FILE.trainingFocusAaa) ?? getTopicArt('aaa'),
    cerebrovascular: asset(FILE.trainingFocusCerebrovascular) ?? getTopicArt('cerebrovascular'),
    carotid: asset(FILE.trainingFocusCerebrovascular) ?? getTopicArt('cerebrovascular'),
    'dialysis-access': asset(FILE.trainingFocusDialysisAccess) ?? getTopicArt('dialysis-access'),
    'mesenteric-renal': asset(FILE.trainingFocusMesentericRenal) ?? getTopicArt('mesenteric-renal'),
    'mesenteric-ischemia': asset(FILE.trainingFocusMesentericRenal) ?? getTopicArt('mesenteric-renal'),
    mesenteric: asset(FILE.trainingFocusMesentericRenal) ?? getTopicArt('mesenteric-renal'),
    pad: asset(FILE.trainingFocusPad) ?? getTopicArt('pad'),
    'peripheral-arterial-disease': asset(FILE.trainingFocusPad) ?? getTopicArt('pad'),
  } as Record<string, string | undefined>,
  fallbackCompactTopic: asset(FILE.genericCompactTopicBackground),
};

export const reusableArt = {
  heroBanner: asset(FILE.genericBannerHero),
  wideBanner: asset(FILE.genericBannerWide),
  mediumBanner: asset(FILE.genericBannerMedium),
  topicCard: asset(FILE.genericTopicCard),
  caseTile: asset(FILE.genericCaseTile),
  compactTopicBackground: asset(FILE.genericCompactTopicBackground),
};

export function getTopicArt(categoryId: string | null | undefined): string | undefined {
  if (!categoryId) return undefined;
  return topicArt[categoryId] ?? getCategoryBackground(categoryId);
}

export function getCaseCardArt(vascCase: Pick<VascCase, 'categoryId' | 'tags'>): string | undefined {
  const direct = getTopicArt(vascCase.categoryId);
  if (direct) return direct;
  const tagText = (vascCase.tags ?? []).join(' ').toLowerCase();
  if (tagText.includes('aneurysm') || tagText.includes('aaa')) return asset(FILE.aneurysmCloseUp);
  if (tagText.includes('carotid')) return asset(FILE.carotidStenosis);
  if (tagText.includes('measurement') || tagText.includes('caliper')) return asset(FILE.vascularMeasurement);
  if (tagText.includes('stent') || tagText.includes('device')) return asset(FILE.angiogramStent);
  return featureArt.imaging;
}

export function getHeroArt(slot: LearnerHeroSlot): string | undefined {
  return heroBackgrounds[slot];
}

// Used by the empty-state fallback when a topic has no specific image yet.
export const fallbackArt = featureArt.overview;
