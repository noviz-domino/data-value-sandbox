// 시드 기반 의사난수 생성기 (mulberry32).
// 같은 seed를 넣으면 항상 같은 순서의 난수가 나온다 — 시뮬레이션 재현성(determinism)의 핵심.
// 프로토타입(phase2/prototype/index.html)의 인라인 `rand` 클로저와 완전히 동일한 알고리즘을 그대로 옮긴 것.

/**
 * mulberry32 PRNG를 생성한다.
 * @param {number} seed - 정수 시드값. 예: 20260903
 * @returns {() => number} 호출할 때마다 [0, 1) 범위의 float를 반환하는 함수.
 */
export function mulberry32(seed) {
  // 클로저 안에 상태(state) a를 가둬둔다 — 호출 사이에도 a 값이 유지되어야
  // 다음 난수가 이전 난수에 이어서 나올 수 있다.
  let a = seed | 0; // |0 : 32비트 정수로 강제 변환(비트 연산은 항상 int32 결과를 만든다)

  return function () {
    // Weyl sequence 증분. 0x6D2B79F5는 mulberry32 알고리즘 고유의 매직 넘버.
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    // 두 번의 xorshift + imul(32비트 정수 곱셈) 혼합으로 비트를 잘 섞는다.
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    // >>> 0으로 부호 없는 32비트 정수로 만든 뒤 2^32로 나눠 [0,1) 범위 float로 정규화.
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
