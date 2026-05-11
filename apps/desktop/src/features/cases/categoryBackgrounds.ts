import aaaBackground from '../../assets/category-backgrounds/aaa.png';
import carotidBackground from '../../assets/category-backgrounds/carotid.png';
import dialysisAccessBackground from '../../assets/category-backgrounds/dialysis-access.png';
import mesentericIschemiaBackground from '../../assets/category-backgrounds/mesenteric-ischemia.png';
import peripheralArterialDiseaseBackground from '../../assets/category-backgrounds/peripheral-arterial-disease.png';

const CATEGORY_BACKGROUNDS: Record<string, string> = {
  aaa: aaaBackground,
  carotid: carotidBackground,
  'dialysis-access': dialysisAccessBackground,
  'mesenteric-ischemia': mesentericIschemiaBackground,
  mesenteric: mesentericIschemiaBackground,
  pad: peripheralArterialDiseaseBackground,
  'peripheral-arterial-disease': peripheralArterialDiseaseBackground,
};

export function getCategoryBackground(categoryId: string): string | undefined {
  return CATEGORY_BACKGROUNDS[categoryId];
}
