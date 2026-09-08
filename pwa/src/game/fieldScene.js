// 질감 없는 단색 SVG 스프라이트. 좌표는 1536×1024 장면 기준이다.
// atlas의 viewBox는 개체 전체와 투명 여백을 포함하며, 가려진 부분을 자르지 않는다.
export const FIELD_ASSETS = {
  backdrop: '/game/field-parts-vector/backdrop.svg',
  trees: { src: '/game/field-parts-vector/trees.svg', width: 1254, height: 1254 },
  shrubs: { src: '/game/field-parts-vector/shrubs.svg', width: 1536, height: 1024 },
  house: { src: '/game/field-parts-vector/house.svg', width: 1536, height: 1024 },
  chimney: { src: '/game/field-parts-vector/chimney.svg', width: 64, height: 170 },
};

export const FIELD_TREES = [
  { name: 'tree-small-left', viewBox: [135, 166, 374, 426], box: [96, 510, 210, 239], pivot: [197, 415] },
  { name: 'tree-small-right', viewBox: [765, 784, 372, 405], box: [1200, 496, 225, 245], pivot: [190, 394] },
  { name: 'tree-left', viewBox: [648, 36, 531, 587], box: [285, 320, 370, 409], pivot: [265, 576] },
  { name: 'tree-right', viewBox: [85, 621, 576, 582], box: [880, 300, 420, 424], pivot: [279, 571] },
];

// 원본 집의 지붕·문·원창 좌표를 유지한 벡터. 가려졌던 벽까지 온전하게 그린다.
export const FIELD_HOUSE = {
  name: 'house', viewBox: [550, 440, 440, 312], box: [550, 440, 440, 312],
};
// 굴뚝 아래를 지붕 레이어가 가리므로 접합부를 사선으로 잘라 맞추지 않는다.
export const FIELD_CHIMNEY = {
  name: 'chimney', viewBox: [0, 0, 64, 170], box: [855, 421, 64, 170],
};
export const FIELD_SMOKE = [874, 422, 27];

const OLIVE_SHRUB = [23, 422, 480, 251];
const LIME_SHRUB = [543, 394, 500, 280];
const DARK_SHRUB = [1106, 461, 407, 212];
export const FIELD_SHRUBS = [
  { name: 'hedge-left-edge', viewBox: OLIVE_SHRUB, box: [-24, 675, 210, 110], layer: 'back' },
  { name: 'hedge-left', viewBox: LIME_SHRUB, box: [267, 641, 195, 109], layer: 'back' },
  { name: 'hedge-right', viewBox: DARK_SHRUB, box: [1080, 631, 218, 113], layer: 'front' },
  { name: 'hedge-right-edge', viewBox: OLIVE_SHRUB, box: [1372, 663, 210, 110], layer: 'back' },
  { name: 'shrub-house-left', viewBox: DARK_SHRUB, box: [420, 665, 183, 95], layer: 'front' },
  { name: 'shrub-house-left-small', viewBox: LIME_SHRUB, box: [551, 702, 109, 61], layer: 'front' },
  { name: 'shrub-house-right', viewBox: OLIVE_SHRUB, box: [936, 676, 170, 89], layer: 'front' },
  { name: 'shrub-foreground-left', viewBox: DARK_SHRUB, box: [54, 836, 196, 102], layer: 'front' },
  { name: 'shrub-foreground-right', viewBox: OLIVE_SHRUB, box: [1350, 749, 130, 68], layer: 'front' },
];
