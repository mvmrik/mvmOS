// Game Hub — SVG Avatar renderer + builder
// Exposes: window.GHAvatar = { avatarSvg, renderAvatar, showBuilder }
(function () {
  'use strict';

  const BG_COLS   = ['#89b4fa','#a6e3a1','#f38ba8','#fab387','#f9e2af','#cba6f7','#94e2d5','#89dceb','#585b70','#313244','#ff6b6b','#ffd93d'];
  const SKIN_COLS = ['#ffd5a8','#f2c08a','#e0a070','#c07840','#8b5530','#4a2c14','#7ec8e3','#6bcb77','#e87461','#b388ff','#f48fb1','#90caf9'];
  const HAIR_COLS = ['#0a0602','#2c1810','#5c3a1e','#9b6b3a','#d4a96a','#f5e6c8','#c0392b','#8e44ad','#2980b9','#95a5a6'];
  const EYE_COLS  = ['#1a0f0a','#2d5a27','#1e3d6b','#6b4c35','#4a4a6a','#c0392b'];

  const DEFAULTS = { bg:'#89b4fa', skin:'#ffd5a8', face:0, ears:0, hair:0, hc:'#2c1810', eyes:0, ec:'#1a0f0a', brows:0, nose:0, mouth:0 };

  function avatarSvg(data, sz) {
    sz = sz || 80;
    const d = Object.assign({}, DEFAULTS, data || {});
    const S=d.skin, H=d.hc, E=d.ec, BG=d.bg, DK='#1a0f0a';

    // All faces: fixed width ~27 units each side of center (cx=50), only height/chin shape varies
    const faces = [
      // 0: perfect circle
      `<ellipse cx="50" cy="55" rx="27" ry="27" fill="${S}"/>`,
      // 1: oval — taller
      `<ellipse cx="50" cy="55" rx="27" ry="32" fill="${S}"/>`,
      // 2: wide & short — flatter
      `<ellipse cx="50" cy="57" rx="27" ry="21" fill="${S}"/>`,
      // 3: pointed chin — wide top, narrow bottom
      `<path d="M23,45 Q23,28 50,28 Q77,28 77,45 Q77,62 50,83 Q23,62 23,45Z" fill="${S}"/>`,
      // 4: square jaw — straight sides, flat chin
      `<path d="M23,30 Q23,28 50,28 Q77,28 77,30 L77,68 Q77,82 50,82 Q23,82 23,68 Z" fill="${S}"/>`,
      // 5: diamond — narrow top & bottom, wide middle
      `<path d="M50,28 Q77,42 77,56 Q77,70 50,83 Q23,70 23,56 Q23,42 50,28Z" fill="${S}"/>`,
      // 6: pear — narrow top, wide bottom/jaw
      `<path d="M50,28 Q65,28 72,42 Q80,58 77,70 Q73,83 50,83 Q27,83 23,70 Q20,58 28,42 Q35,28 50,28Z" fill="${S}"/>`,
      // 7: heart — wide forehead, narrow chin
      `<path d="M23,38 Q23,28 50,28 Q77,28 77,38 Q77,52 62,68 Q55,78 50,83 Q45,78 38,68 Q23,52 23,38Z" fill="${S}"/>`,
      // 8: oblong — very tall oval
      `<ellipse cx="50" cy="55" rx="27" ry="36" fill="${S}"/>`,
      // 9: soft pentagon — wide cheeks, gentle point
      `<path d="M23,42 Q25,28 50,28 Q75,28 77,42 Q80,60 65,76 Q57,83 50,83 Q43,83 35,76 Q20,60 23,42Z" fill="${S}"/>`,
      // 10: trapezoid — wide forehead, wider jaw (inverted triangle feel)
      `<path d="M30,28 Q50,26 70,28 L77,68 Q73,83 50,83 Q27,83 23,68 Z" fill="${S}"/>`,
      // 11: asymmetric lean — slight tilt, one side flatter
      `<path d="M24,42 Q27,28 50,28 Q74,29 76,44 Q78,62 52,83 Q43,82 24,65 Q21,54 24,42Z" fill="${S}"/>`,
      // 12: rectangular with rounded top, flat bottom
      `<path d="M23,40 Q23,28 50,28 Q77,28 77,40 L77,76 L23,76 Z" fill="${S}"/>`,
      // 13: very sharp V-chin — dramatic point
      `<path d="M23,40 Q23,28 50,28 Q77,28 77,40 Q77,58 50,88 Q23,58 23,40Z" fill="${S}"/>`,
    ];

    const earParts = [
      // 0: no ears
      ``,
      // 1: small round
      `<ellipse cx="22" cy="55" rx="5" ry="6.5" fill="${S}"/><ellipse cx="78" cy="55" rx="5" ry="6.5" fill="${S}"/>`,
      // 2: large round
      `<ellipse cx="19" cy="55" rx="7.5" ry="9.5" fill="${S}"/><ellipse cx="81" cy="55" rx="7.5" ry="9.5" fill="${S}"/>`,
      // 3: pointed elf ears
      `<path d="M25,48 L15,38 L22,62 Z" fill="${S}"/><path d="M75,48 L85,38 L78,62 Z" fill="${S}"/>`,
      // 4: small round with inner detail
      `<ellipse cx="22" cy="55" rx="5" ry="6.5" fill="${S}"/><ellipse cx="78" cy="55" rx="5" ry="6.5" fill="${S}"/><ellipse cx="22" cy="55" rx="2.5" ry="3.5" fill="${DK}" opacity="0.12"/><ellipse cx="78" cy="55" rx="2.5" ry="3.5" fill="${DK}" opacity="0.12"/>`,
      // 5: large with inner detail
      `<ellipse cx="19" cy="55" rx="7.5" ry="9.5" fill="${S}"/><ellipse cx="81" cy="55" rx="7.5" ry="9.5" fill="${S}"/><ellipse cx="19" cy="55" rx="4" ry="5.5" fill="${DK}" opacity="0.1"/><ellipse cx="81" cy="55" rx="4" ry="5.5" fill="${DK}" opacity="0.1"/>`,
      // 6: wide flat ears
      `<ellipse cx="20" cy="56" rx="8" ry="6" fill="${S}"/><ellipse cx="80" cy="56" rx="8" ry="6" fill="${S}"/>`,
      // 7: tall narrow ears
      `<ellipse cx="22" cy="54" rx="4" ry="11" fill="${S}"/><ellipse cx="78" cy="54" rx="4" ry="11" fill="${S}"/>`,
      // 8: rounded square ears
      `<rect x="14" y="48" width="10" height="14" rx="3" fill="${S}"/><rect x="76" y="48" width="10" height="14" rx="3" fill="${S}"/>`,
      // 9: tiny high ears
      `<ellipse cx="23" cy="46" rx="4" ry="5" fill="${S}"/><ellipse cx="77" cy="46" rx="4" ry="5" fill="${S}"/>`,
      // 10: floppy/droopy ears — hang down low
      `<path d="M23,52 Q16,52 14,62 Q13,75 20,78 Q24,80 25,68 Q26,58 23,52Z" fill="${S}"/><path d="M77,52 Q84,52 86,62 Q87,75 80,78 Q76,80 75,68 Q74,58 77,52Z" fill="${S}"/>`,
      // 11: long elf ears pointing outward
      `<path d="M24,50 L8,44 L22,62 Z" fill="${S}"/><path d="M76,50 L92,44 L78,62 Z" fill="${S}"/>`,
      // 12: very large floppy — big droopy
      `<path d="M23,48 Q13,48 11,62 Q10,78 18,82 Q23,84 24,70 Q25,56 23,48Z" fill="${S}"/><path d="M77,48 Q87,48 89,62 Q90,78 82,82 Q77,84 76,70 Q75,56 77,48Z" fill="${S}"/>`,
      // 13: cat/pointed ears on top of head
      `<path d="M32,32 L28,18 L40,28 Z" fill="${S}"/><path d="M68,32 L72,18 L60,28 Z" fill="${S}"/>`,
    ];

    // hairBack: drawn BEFORE face (behind), covers skull/back
    // hairFront: drawn AFTER face features (on top), adds fringe/detail only on forehead area
    const hairBack = [
      // 0: bald
      ``,
      // 1: short — skull cap, no back length
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/>`,
      // 2: medium bob — covers to ear level in back
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><path d="M22,44 Q22,50 24,58 Q28,64 23,64 Q20,56 22,44Z" fill="${H}"/><path d="M78,44 Q78,50 76,58 Q72,64 77,64 Q80,56 78,44Z" fill="${H}"/>`,
      // 3: long straight — falls past face on sides
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><rect x="21" y="44" width="8" height="38" rx="4" fill="${H}"/><rect x="71" y="44" width="8" height="38" rx="4" fill="${H}"/>`,
      // 4: very long — reaches bottom of avatar
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><rect x="21" y="44" width="8" height="52" rx="4" fill="${H}"/><rect x="71" y="44" width="8" height="52" rx="4" fill="${H}"/>`,
      // 5: ponytail — short sides, tail at back center
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><ellipse cx="50" cy="88" rx="5" ry="14" fill="${H}"/>`,
      // 6: afro — big puff all around
      `<ellipse cx="50" cy="38" rx="34" ry="28" fill="${H}"/>`,
      // 7: mohawk — shaved sides, center ridge
      ``,
      // 8: side-swept — full back coverage
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/>`,
      // 9: twin tails — back with two side tails
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><ellipse cx="26" cy="72" rx="5" ry="16" fill="${H}"/><ellipse cx="74" cy="72" rx="5" ry="16" fill="${H}"/>`,
      // 10: wavy long — wide flowing back
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><path d="M21,44 Q18,60 22,76 Q24,86 21,92 Q26,84 24,72 Q22,58 25,44Z" fill="${H}"/><path d="M79,44 Q82,60 78,76 Q76,86 79,92 Q74,84 76,72 Q78,58 75,44Z" fill="${H}"/>`,
      // 11: bun — tight back, bun on top rear
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><circle cx="50" cy="22" r="9" fill="${H}"/>`,
      // 12: extra long — very wide thick curtains down both sides
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><path d="M21,44 Q14,56 14,72 Q14,88 18,96 Q22,88 22,72 Q22,56 25,44Z" fill="${H}"/><path d="M79,44 Q86,56 86,72 Q86,88 82,96 Q78,88 78,72 Q78,56 75,44Z" fill="${H}"/>`,
      // 13: massive long — very wide solid panels covering sides of face all the way down
      `<ellipse cx="50" cy="36" rx="28" ry="20" fill="${H}"/><path d="M22,44 Q10,50 8,68 Q7,84 10,98 Q16,90 16,74 Q16,58 22,46Z" fill="${H}"/><path d="M78,44 Q90,50 92,68 Q93,84 90,98 Q84,90 84,74 Q84,58 78,46Z" fill="${H}"/>`,
    ];

    const hairFront = [
      // 0: bald
      ``,
      // 1: short — hairline at ~y44, covers forehead+skull
      `<path d="M22,44 Q22,26 50,24 Q78,26 78,44 Q66,36 50,35 Q34,36 22,44Z" fill="${H}"/>`,
      // 2: medium bob
      `<path d="M22,46 Q22,26 50,24 Q78,26 78,46 Q66,37 50,36 Q34,37 22,46Z" fill="${H}"/>`,
      // 3: long straight
      `<path d="M22,46 Q22,26 50,24 Q78,26 78,46 Q66,37 50,36 Q34,37 22,46Z" fill="${H}"/>`,
      // 4: very long
      `<path d="M22,46 Q22,26 50,24 Q78,26 78,46 Q66,37 50,36 Q34,37 22,46Z" fill="${H}"/>`,
      // 5: ponytail
      `<path d="M22,44 Q22,26 50,24 Q78,26 78,44 Q66,36 50,35 Q34,36 22,44Z" fill="${H}"/>`,
      // 6: afro — just a slight front edge
      `<path d="M22,48 Q22,28 50,24 Q78,28 78,48 Q66,40 50,39 Q34,40 22,48Z" fill="${H}"/>`,
      // 7: mohawk — center spike
      `<path d="M44,44 Q45,22 50,12 Q55,22 56,44 Q53,36 50,34 Q47,36 44,44Z" fill="${H}"/>`,
      // 8: side-swept — dips lower on right side
      `<path d="M22,44 Q24,26 50,24 Q78,26 78,44 Q70,34 58,36 Q46,38 34,42 Q28,44 22,44Z" fill="${H}"/>`,
      // 9: twin tails — center part dip
      `<path d="M22,44 Q22,26 50,24 Q78,26 78,44 Q68,36 56,37 Q53,38 50,40 Q47,38 44,37 Q32,36 22,44Z" fill="${H}"/>`,
      // 10: wavy fringe — bumpy bottom edge
      `<path d="M22,44 Q22,26 50,24 Q78,26 78,44 Q72,36 64,38 Q57,34 50,37 Q43,34 36,38 Q28,36 22,44Z" fill="${H}"/>`,
      // 11: bun — high hairline, bun on top
      `<path d="M22,42 Q22,26 50,24 Q78,26 78,42 Q66,34 50,33 Q34,34 22,42Z" fill="${H}"/><circle cx="50" cy="18" r="9" fill="${H}"/>`,
      // 12: extra long — wide fringe, thick sides visible on face
      `<path d="M18,50 Q18,26 50,24 Q82,26 82,50 Q72,38 50,37 Q28,38 18,50Z" fill="${H}"/>`,
      // 13: massive long — very wide fringe, covers cheeks
      `<path d="M12,54 Q12,24 50,22 Q88,24 88,54 Q76,40 50,39 Q24,40 12,54Z" fill="${H}"/>`,
    ];

    const eyeParts = [
      // 0: small dots
      `<circle cx="40" cy="52" r="3.5" fill="${E}"/><circle cx="60" cy="52" r="3.5" fill="${E}"/>`,
      // 1: wide almond
      `<ellipse cx="40" cy="52" rx="5.5" ry="3.8" fill="${E}"/><ellipse cx="60" cy="52" rx="5.5" ry="3.8" fill="${E}"/>`,
      // 2: big round with white
      `<circle cx="40" cy="52" r="5.5" fill="white"/><circle cx="40" cy="52" r="3.5" fill="${E}"/><circle cx="60" cy="52" r="5.5" fill="white"/><circle cx="60" cy="52" r="3.5" fill="${E}"/>`,
      // 3: upward curve (happy squint)
      `<path d="M36,52 Q40,48 44,52" stroke="${E}" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M56,52 Q60,48 64,52" stroke="${E}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`,
      // 4: leaf shape
      `<path d="M36,52 Q40,49.5 44,52 Q40,55 36,52Z" fill="${E}"/><path d="M56,52 Q60,49.5 64,52 Q60,55 56,52Z" fill="${E}"/>`,
      // 5: very large round with white
      `<circle cx="40" cy="52" r="7" fill="white"/><circle cx="40" cy="52" r="4.5" fill="${E}"/><circle cx="60" cy="52" r="7" fill="white"/><circle cx="60" cy="52" r="4.5" fill="${E}"/>`,
      // 6: downward curve (sad)
      `<path d="M36,50 Q40,54 44,50" stroke="${E}" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M56,50 Q60,54 64,50" stroke="${E}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`,
      // 7: star/sparkle eyes
      `<text x="37" y="56" font-size="10" text-anchor="middle" fill="${E}">★</text><text x="63" y="56" font-size="10" text-anchor="middle" fill="${E}">★</text>`,
      // 8: narrow slit
      `<ellipse cx="40" cy="52" rx="5" ry="1.8" fill="${E}"/><ellipse cx="60" cy="52" rx="5" ry="1.8" fill="${E}"/>`,
      // 9: X eyes
      `<path d="M36,49 L44,55 M44,49 L36,55" stroke="${E}" stroke-width="2.5" stroke-linecap="round"/><path d="M56,49 L64,55 M64,49 L56,55" stroke="${E}" stroke-width="2.5" stroke-linecap="round"/>`,
      // 10: wink — left closed, right open
      `<path d="M35,51 Q40,49 45,51" stroke="${E}" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="60" cy="52" r="4.5" fill="white"/><circle cx="60" cy="52" r="3" fill="${E}"/>`,
      // 11: heart eyes
      `<path d="M37,50 Q37,47 40,47 Q43,47 43,50 Q43,53 40,55 Q37,53 37,50Z" fill="${E}"/><path d="M57,50 Q57,47 60,47 Q63,47 63,50 Q63,53 60,55 Q57,53 57,50Z" fill="${E}"/>`,
      // 12: spiral/dizzy
      `<path d="M37,52 Q38,49 40,50 Q42,51 41,53 Q40,55 38,54" stroke="${E}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M57,52 Q58,49 60,50 Q62,51 61,53 Q60,55 58,54" stroke="${E}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 13: large almond with white
      `<ellipse cx="40" cy="52" rx="7" ry="4.5" fill="white"/><ellipse cx="40" cy="52" rx="4.5" ry="3" fill="${E}"/><ellipse cx="60" cy="52" rx="7" ry="4.5" fill="white"/><ellipse cx="60" cy="52" rx="4.5" ry="3" fill="${E}"/>`,
    ];

    const eyeShine = (d.eyes < 3 || d.eyes === 5 || d.eyes === 13)
      ? `<circle cx="42" cy="50.5" r="1.3" fill="white" opacity="0.9"/><circle cx="62" cy="50.5" r="1.3" fill="white" opacity="0.9"/>`
      : '';

    const browParts = [
      // 0: flat gentle arch
      `<path d="M36,46.5 Q40,45 44,46.5" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56,46.5 Q60,45 64,46.5" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 1: high arch
      `<path d="M36,47 Q40,43 44,47" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56,47 Q60,43 64,47" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 2: angry inner raise
      `<path d="M36,45 Q40,41.5 43.5,43.5" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56.5,43.5 Q60,41.5 64,45" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 3: sad inner lower
      `<path d="M36.5,44.5 Q40,47 43.5,44.5" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56.5,44.5 Q60,47 63.5,44.5" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 4: none
      ``,
      // 5: thick bushy
      `<path d="M35,46 Q40,44 45,46" stroke="${DK}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M55,46 Q60,44 65,46" stroke="${DK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
      // 6: thin straight
      `<line x1="36" y1="45.5" x2="44" y2="45.5" stroke="${DK}" stroke-width="1.2" stroke-linecap="round"/><line x1="56" y1="45.5" x2="64" y2="45.5" stroke="${DK}" stroke-width="1.2" stroke-linecap="round"/>`,
      // 7: one brow raised (quirky)
      `<path d="M36,47 Q40,45 44,47" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56,44 Q60,41 64,44" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 8: very high arched
      `<path d="M36,48 Q40,41 44,48" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56,48 Q60,41 64,48" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      // 9: zigzag angry
      `<path d="M36,46 L38,44 L40,46 L42,44 L44,46" stroke="${DK}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M56,46 L58,44 L60,46 L62,44 L64,46" stroke="${DK}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      // 10: unibrow
      `<path d="M35,45.5 Q50,42 65,45.5" stroke="${DK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
      // 11: dots (no brow line)
      `<circle cx="40" cy="45" r="1.5" fill="${DK}" opacity="0.5"/><circle cx="60" cy="45" r="1.5" fill="${DK}" opacity="0.5"/>`,
      // 12: thick furrow (V shape)
      `<path d="M35,46 Q38,43 41,45" stroke="${DK}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M59,45 Q62,43 65,46" stroke="${DK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      // 13: wavy
      `<path d="M36,46 Q38,44 40,46 Q42,48 44,46" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M56,46 Q58,44 60,46 Q62,48 64,46" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ];

    const noseParts = [
      // 0: none
      ``,
      // 1: two dots
      `<circle cx="47.5" cy="62" r="1.8" fill="${DK}" opacity="0.38"/><circle cx="52.5" cy="62" r="1.8" fill="${DK}" opacity="0.38"/>`,
      // 2: triangle
      `<path d="M50,57 L47,63 Q50,65 53,63 Z" fill="${DK}" opacity="0.24"/>`,
      // 3: single dot
      `<circle cx="50" cy="61" r="2.2" fill="${DK}" opacity="0.22"/>`,
      // 4: line nose
      `<path d="M48,58 L46,63 M52,58 L54,63" stroke="${DK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
      // 5: button nose
      `<ellipse cx="50" cy="62" rx="4" ry="2.5" fill="${DK}" opacity="0.18"/>`,
      // 6: big round nose
      `<circle cx="50" cy="62" r="4" fill="${DK}" opacity="0.2"/>`,
      // 7: wide nostrils
      `<circle cx="46" cy="63" r="2.5" fill="${DK}" opacity="0.25"/><circle cx="54" cy="63" r="2.5" fill="${DK}" opacity="0.25"/>`,
      // 8: small upturned
      `<path d="M47,62 Q50,60 53,62" stroke="${DK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
      // 9: hook/curved
      `<path d="M50,57 Q54,60 52,64 Q50,66 48,64" stroke="${DK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
      // 10: W shape nostrils
      `<path d="M45,62 Q47,64 49,62 Q50,61 51,62 Q53,64 55,62" stroke="${DK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
      // 11: pig nose (two circles)
      `<ellipse cx="50" cy="63" rx="5" ry="3.5" fill="${DK}" opacity="0.15"/><circle cx="47.5" cy="63" r="1.5" fill="${DK}" opacity="0.3"/><circle cx="52.5" cy="63" r="1.5" fill="${DK}" opacity="0.3"/>`,
      // 12: small straight lines
      `<line x1="47" y1="61" x2="47" y2="64" stroke="${DK}" stroke-width="1.5" stroke-linecap="round"/><line x1="53" y1="61" x2="53" y2="64" stroke="${DK}" stroke-width="1.5" stroke-linecap="round"/>`,
      // 13: big triangle
      `<path d="M50,55 L44,65 Q50,68 56,65 Z" fill="${DK}" opacity="0.2"/>`,
    ];

    const mouthParts = [
      // 0: smile
      `<path d="M42,68 Q50,75 58,68" stroke="${DK}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      // 1: big open smile with teeth
      `<path d="M40,67 Q50,78 60,67 Q50,75 40,67Z" fill="white" stroke="${DK}" stroke-width="1.5" stroke-linejoin="round"/>`,
      // 2: straight line
      `<path d="M43,68 L57,68" stroke="${DK}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      // 3: smirk
      `<path d="M43,68 Q49,73 55,67" stroke="${DK}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      // 4: small O mouth
      `<ellipse cx="50" cy="70" rx="4.5" ry="4" fill="${DK}" opacity="0.6"/>`,
      // 5: wide grin
      `<path d="M38,67 Q50,78 62,67 Q50,74 38,67Z" fill="white" stroke="${DK}" stroke-width="1.5"/>`,
      // 6: frown
      `<path d="M42,72 Q50,65 58,72" stroke="${DK}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      // 7: tiny dot mouth
      `<circle cx="50" cy="69" r="2" fill="${DK}" opacity="0.5"/>`,
      // 8: big O surprised
      `<ellipse cx="50" cy="70" rx="7" ry="6" fill="${DK}" opacity="0.55"/>`,
      // 9: cat mouth
      `<path d="M46,68 Q48,71 50,68 Q52,71 54,68" stroke="${DK}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      // 10: zipper mouth
      `<path d="M43,68 L57,68" stroke="${DK}" stroke-width="2.5" fill="none" stroke-linecap="round"/><line x1="45" y1="66" x2="45" y2="70" stroke="${DK}" stroke-width="1.2"/><line x1="48" y1="66" x2="48" y2="70" stroke="${DK}" stroke-width="1.2"/><line x1="51" y1="66" x2="51" y2="70" stroke="${DK}" stroke-width="1.2"/><line x1="54" y1="66" x2="54" y2="70" stroke="${DK}" stroke-width="1.2"/>`,
      // 11: tongue out
      `<path d="M43,67 Q50,74 57,67" stroke="${DK}" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="74" rx="4" ry="3" fill="#f38ba8"/>`,
      // 12: buck teeth
      `<path d="M42,67 Q50,74 58,67" stroke="${DK}" stroke-width="1.5" fill="none" stroke-linecap="round"/><rect x="46" y="67" width="4" height="4" rx="1" fill="white" stroke="${DK}" stroke-width="0.8"/><rect x="50" y="67" width="4" height="4" rx="1" fill="white" stroke="${DK}" stroke-width="0.8"/>`,
      // 13: wide open scream
      `<path d="M42,66 Q50,80 58,66 Q50,78 42,66Z" fill="${DK}" opacity="0.7"/>`,
    ];

    const f  = faces[d.face%14];
    const ea = earParts[d.ears%14];
    const hb = hairBack[d.hair%14];
    const hf = hairFront[d.hair%14];
    const ey = eyeParts[d.eyes%14];
    const br = browParts[d.brows%14];
    const ns = noseParts[d.nose%14];
    const mo = mouthParts[d.mouth%14];

    return `<svg viewBox="0 0 100 100" width="${sz}" height="${sz}" style="border-radius:50%;display:block;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="${BG}"/>${ea}${hb}${f}${hf}${ey}${eyeShine}${br}${ns}${mo}</svg>`;
  }

  function renderAvatar(player, size) {
    size = size || 36;
    if (player && player.avatar_svg) {
      // replace width/height attrs in the stored SVG to match requested size
      return player.avatar_svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
    }
    if (player && player.avatar_data) {
      let data = player.avatar_data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch(e) { data = null; } }
      if (data) return avatarSvg(data, size);
    }
    const color = (player && player.avatar_color) || '#585b70';
    const letter = ((player && player.display_name && player.display_name[0]) || '?').toUpperCase();
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="border-radius:50%;display:block;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50" y="67" font-family="system-ui,sans-serif" font-size="54" font-weight="700" fill="#1e1e2e" text-anchor="middle">${letter}</text></svg>`;
  }

  function showBuilder(currentData, avatarColor, onSave) {
    let d = Object.assign({}, DEFAULTS);
    if (avatarColor) d.bg = avatarColor;
    if (currentData) {
      try { Object.assign(d, typeof currentData === 'string' ? JSON.parse(currentData) : currentData); } catch(e) {}
    }

    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:stretch;justify-content:center';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface1,#1e1e2e);width:100%;max-width:440px;display:flex;flex-direction:column;box-sizing:border-box';
    ov.appendChild(box);
    document.body.appendChild(ov);

    function lbl(text) {
      return `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--fg2,#a6adc8);margin-bottom:6px">${text}</div>`;
    }

    function colSwatches(cols, field) {
      return `<div style="display:flex;flex-wrap:wrap;gap:7px">${
        cols.map(c => `<div data-f="${field}" data-c="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;outline:3px solid ${d[field]===c?'#fff':'transparent'};outline-offset:2px;flex-shrink:0"></div>`).join('')
      }</div>`;
    }

    function optBtns(count, field) {
      let html = `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
      for (let i = 0; i < count; i++) {
        const sel = d[field] === i;
        html += `<div data-f="${field}" data-o="${i}" style="cursor:pointer;border-radius:8px;border:2px solid ${sel?'var(--accent,#6366f1)':'var(--border,#45475a)'};padding:2px;line-height:0;flex-shrink:0">${avatarSvg(Object.assign({},d,{[field]:i}),38)}</div>`;
      }
      return html + '</div>';
    }

    let _openSection = null;

    function accordion(title, contentFn, key) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'border:1px solid var(--border,#45475a);border-radius:8px;overflow:hidden';
      const isOpen = _openSection === key;
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 12px;cursor:pointer;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--fg2,#a6adc8);user-select:none';
      header.innerHTML = `<span>${title}</span><span style="font-size:16px">${isOpen ? '▾' : '▸'}</span>`;
      const body = document.createElement('div');
      body.style.cssText = `padding:${isOpen ? '10px 12px 12px' : '0'};max-height:${isOpen ? '500px' : '0'};overflow:hidden;transition:max-height .2s ease,padding .2s ease`;
      if (isOpen) body.innerHTML = contentFn();
      header.onclick = () => { _openSection = isOpen ? null : key; rebuild(); };
      wrap.appendChild(header);
      wrap.appendChild(body);
      return wrap;
    }

    // Fixed top panel — preview + title + save
    const topPanel = document.createElement('div');
    topPanel.style.cssText = 'flex-shrink:0;display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--border,#45475a)';
    box.appendChild(topPanel);

    // Scrollable accordion area
    const scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:12px 16px;box-sizing:border-box';
    box.appendChild(scrollArea);

    const sections = [
      { key:'bg',    title:'Background', html:() => colSwatches(BG_COLS,'bg') },
      { key:'skin',  title:'Skin',       html:() => colSwatches(SKIN_COLS,'skin') },
      { key:'face',  title:'Face',       html:() => optBtns(14,'face') },
      { key:'ears',  title:'Ears',       html:() => optBtns(14,'ears') },
      { key:'hair',  title:'Hair',       html:() => optBtns(14,'hair') + `<div style="border-top:1px solid var(--border,#45475a);margin:10px 0 8px"></div>` + colSwatches(HAIR_COLS,'hc') },
      { key:'eyes',  title:'Eyes',       html:() => optBtns(14,'eyes') + `<div style="border-top:1px solid var(--border,#45475a);margin:10px 0 8px"></div>` + colSwatches(EYE_COLS,'ec') },
      { key:'brows', title:'Eyebrows',   html:() => optBtns(14,'brows') },
      { key:'nose',  title:'Nose',       html:() => optBtns(14,'nose') },
      { key:'mouth', title:'Mouth',      html:() => optBtns(14,'mouth') },
    ];

    function rebuild() {
      // Update top panel
      topPanel.innerHTML = `
        <div id="av-preview">${avatarSvg(d, 72)}</div>
        <div style="flex:1;font-weight:700;font-size:15px">Customize Avatar</div>
        <button id="av-save" style="background:var(--accent,#6366f1);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer">Save</button>
        <button id="av-x" style="background:none;border:none;color:var(--fg,#cdd6f4);cursor:pointer;font-size:22px;line-height:1;padding:2px 6px">✕</button>`;
      topPanel.querySelector('#av-x').onclick = () => ov.remove();
      topPanel.querySelector('#av-save').onclick = () => { ov.remove(); onSave(JSON.stringify(d)); };

      // Rebuild accordion list (preserve scroll position)
      const prevScroll = scrollArea.scrollTop;
      scrollArea.innerHTML = '';
      sections.forEach(s => scrollArea.appendChild(accordion(s.title, s.html, s.key)));
      scrollArea.scrollTop = prevScroll;

      scrollArea.querySelectorAll('[data-c]').forEach(el => { el.onclick = () => { d[el.dataset.f] = el.dataset.c; rebuild(); }; });
      scrollArea.querySelectorAll('[data-o]').forEach(el => { el.onclick = () => { d[el.dataset.f] = parseInt(el.dataset.o); rebuild(); }; });
    }

    rebuild();
  }

  function randomAvatarData(avatarColor) {
    const rand = n => Math.floor(Math.random() * n);
    return {
      bg:   avatarColor || BG_COLS[rand(BG_COLS.length)],
      skin: SKIN_COLS[rand(SKIN_COLS.length)],
      face: rand(4),
      ears: rand(4),
      hair: rand(5),
      hc:   HAIR_COLS[rand(HAIR_COLS.length)],
      eyes: rand(5),
      ec:   EYE_COLS[rand(EYE_COLS.length)],
      brows: rand(5),
      nose: rand(4),
      mouth: rand(5),
    };
  }

  window.GHAvatar = { avatarSvg, renderAvatar, showBuilder, randomAvatarData, DEFAULTS };
})();
