import aaaBackground from '../../assets/category-backgrounds/aaa.png';
import carotidBackground from '../../assets/category-backgrounds/carotid.png';
import dialysisAccessBackground from '../../assets/category-backgrounds/dialysis-access.png';
import mesentericIschemiaBackground from '../../assets/category-backgrounds/mesenteric-ischemia.png';
import peripheralArterialDiseaseBackground from '../../assets/category-backgrounds/peripheral-arterial-disease.png';
import topicAaaBackground from '../../assets/learner/topic-aaa.png';
import topicCerebrovascularBackground from '../../assets/learner/topic-cerebrovascular.png';
import topicDialysisAccessBackground from '../../assets/learner/topic-dialysis-access.png';
import topicMesentericRenalBackground from '../../assets/learner/topic-mesenteric-renal.png';
import topicPeripheralArterialDiseaseBackground from '../../assets/learner/topic-peripheral-arterial-disease.png';
import topicThoracicBackground from '../../assets/learner/topic-thoracic-aorta-arch.png';
import topicVenousBackground from '../../assets/learner/topic-venous.png';

const CATEGORY_BACKGROUNDS: Record<string, string> = {
  aaa: topicAaaBackground ?? aaaBackground,
  cerebrovascular: topicCerebrovascularBackground,
  carotid: topicCerebrovascularBackground ?? carotidBackground,
  'dialysis-access': topicDialysisAccessBackground ?? dialysisAccessBackground,
  'mesenteric-renal': topicMesentericRenalBackground,
  'mesenteric-ischemia': topicMesentericRenalBackground ?? mesentericIschemiaBackground,
  mesenteric: topicMesentericRenalBackground ?? mesentericIschemiaBackground,
  pad: topicPeripheralArterialDiseaseBackground ?? peripheralArterialDiseaseBackground,
  'peripheral-arterial-disease': topicPeripheralArterialDiseaseBackground ?? peripheralArterialDiseaseBackground,
  thoracic: topicThoracicBackground,
  venous: topicVenousBackground,
};

export function getCategoryBackground(categoryId: string): string | undefined {
  return CATEGORY_BACKGROUNDS[categoryId];
}
