// GTD(Global Terrorism Database) 실측 무기(weapon type) 분포를 코드에서 쓸 수 있는 비율로 바꿔주는
// 순수 함수 모음. 값 자체는 phase1/knn.ipynb 셀 2(`weapontype_num = df.groupby('weapontype'); weapontype_num.size()`)의
// 실행 결과(1970~2015년 GTD 레코드, df는 terror/arms_DF_ver2.csv에서 로드)에서 그대로 옮겨 적었다:
//
//   weapontype
//   Chemical                       203
//   Explosives/Bombs/Dynamite    77755
//   Firearms                     49801
//   Melee                         2922
//   dtype: int64
//
// 총 130681건(=203+77755+49801+2922). 이 파일은 **건수(정수)만** 상수로 갖고, 비율은 항상 함수
// 안에서 나눗셈으로 유도한다 — 나중에 다른 기간·다른 GTD 서브셋으로 바꿔도 출처를 그대로 추적할 수 있게 하기 위해서다.
//
// organizations.js의 METHODS에서 쓰는 방법(method) 문자열에 맞춰 GTD 범주명을 아래처럼 키 이름으로 옮겼다:
//   "Explosives/Bombs/Dynamite" -> "explosive"
//   "Firearms"                  -> "firearm"
//   "Melee"                     -> "melee"
//   "Chemical"                  -> "chemical" (지금은 어떤 branch도 이 키를 쓰지 않지만, 출처 보존을 위해 남겨둔다)
// organizations.js가 쓰는 "vessel_ram"(선박 충돌), "incendiary"(방화)는 GTD weapontype 범주에 없으므로
// 여기 없다 — gtdShares()/blendWithFixed()를 호출할 때 자동으로 무시된다.

/** GTD 원시 집계 건수(정수). 위 출처 주석 참고. 소수로 미리 계산해두지 않는다. */
export const GTD_WEAPON_COUNTS = {
  explosive: 77755, // Explosives/Bombs/Dynamite
  firearm: 49801, // Firearms
  melee: 2922, // Melee
  chemical: 203, // Chemical
};

/**
 * keys 중 GTD_WEAPON_COUNTS에 있는 키만 골라, 그 건수 비율대로 재정규화한 배열을 돌려준다.
 * GTD에 없는 키(예: vessel_ram, incendiary)는 조용히 걸러진다 — 반환 배열의 길이가 keys보다
 * 짧아질 수 있으므로, 원래 배열과 인덱스를 맞춰야 하는 호출부는 blendWithFixed()를 대신 써야 한다.
 * @param {string[]} keys - 비율을 구하고 싶은 방법(method) 키 배열
 * @returns {number[]} keys 중 GTD에 있는 것들만, 그 순서 그대로, 합이 1이 되도록 재정규화한 비율 배열
 */
export function gtdShares(keys) {
  const known = keys.filter((k) => k in GTD_WEAPON_COUNTS); // GTD 범주에 없는 키(vessel_ram 등)는 제외
  const total = known.reduce((sum, k) => sum + GTD_WEAPON_COUNTS[k], 0);
  return known.map((k) => GTD_WEAPON_COUNTS[k] / total); // 건수 비율 = 그 키의 건수 / 알려진 키들의 건수 합
}

/**
 * keys 순서를 그대로 유지한 채, fixed에 지정된 키는 그 고정 비율을 유지하고, 나머지 키들은
 * 남은 비율(1 - fixed 값의 합)을 GTD 실측 비율대로 나눠 갖는 배열을 돌려준다.
 * 예: blendWithFixed(["explosive","firearm","vessel_ram"], {vessel_ram: 0.15})
 *     -> vessel_ram은 0.15 그대로, explosive/firearm이 남은 0.85를 GTD 비율(explosive:firearm)로 분배.
 * @param {string[]} keys - 최종 weights 배열과 순서가 같아야 하는 방법 키 배열
 * @param {Record<string, number>} fixed - {키: 고정비율} — GTD에 없는 값(임의로 정한 비율)을 그대로 살릴 때 쓴다
 * @returns {number[]} keys와 같은 길이·순서의 최종 비율 배열
 */
export function blendWithFixed(keys, fixed) {
  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0); // 고정된 비율들의 합
  const remainingShare = 1 - fixedSum; // 나머지 키들이 나눠 가질 몫
  const remainingKeys = keys.filter((k) => !(k in fixed)); // fixed에 없는 키만 GTD 비율 대상
  const knownRemaining = remainingKeys.filter((k) => k in GTD_WEAPON_COUNTS); // 그중 GTD에 실제로 있는 것만
  const shares = gtdShares(knownRemaining); // knownRemaining과 같은 순서의 GTD 비율

  return keys.map((k) => {
    if (k in fixed) return fixed[k]; // 고정 비율은 그대로 반환
    const idx = knownRemaining.indexOf(k);
    if (idx === -1) return 0; // fixed에도 없고 GTD에도 없는 키 — 호출부에서 나올 일이 없어야 하지만 안전하게 0 처리
    return shares[idx] * remainingShare; // GTD 비율 * 남은 몫
  });
}
