import {
  Canvas,
  createPicture,
  matchFont,
  Picture,
  Skia,
  useClock,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

const BACKGROUND = '#ffffff';
const PARTICLE_COUNT = 180;
const FOCAL_SCALE = 2.3; // perspective strength, relative to screen width

const HEADLINES_AND_BODY = [
  'BREAKING STORM SWEEPS THE HARBOR DISTRICT',
  'Residents report winds above ninety miles per hour as sirens sounded across the old docks.',
  'City officials urged families to stay indoors while crews secured loose signs and cranes.',
  'Power was restored to most neighborhoods by midnight, though several bridges remain closed.',
  'Forecasters now expect the system to weaken over the open water before dawn tomorrow.',
  'Local schools will remain closed until engineers complete inspections of roofs and gymnasiums.',
  'Shoppers lined up early at the market, buying water, batteries and candles in large numbers.',
  'The mayor praised volunteers who opened shelters and delivered meals to elderly residents.',
  'Insurance adjusters expect thousands of claims as damage assessments continue through the week.',
  'Harbor pilots said the channel was clear but warned that debris could drift for several days.',
  'Historians noted that this is the strongest storm to strike the coast since the early nineties.',
  'Read the full report on page six, and follow our live coverage for updated road closures.',
];

const WORDS = HEADLINES_AND_BODY.join(' ').split(' ').filter(Boolean);

// Three font sizes; each particle picks one, so the field has near, mid and far type.
const SIZE_TIERS = 3;

type Particle = {
  word: number; // index into WORDS
  tier: number; // index into the font size tiers
  duration: number; // seconds for one burst-and-rise cycle
  offset: number; // 0..1, staggers cycles so the field never empties
  reach: number; // radial spread, as a fraction of screen width
  theta0: number; // starting angle (radians)
  omega: number; // spin speed (radians per second)
  swirl: number; // extra angle gained over one cycle (radians)
  rise: number; // upward travel, as a fraction of screen height
  sway: number; // underwater wobble amplitude, as a fraction of screen width
  swayFreq: number;
  swayPhase: number;
  spin: number; // tilt wobble amplitude (degrees)
  spinFreq: number;
};

// Small seeded PRNG so the layout is the same on every launch.
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeParticles(): Particle[] {
  const random = createRandom(20260510);
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    word: i % WORDS.length,
    tier: Math.floor(random() * SIZE_TIERS),
    duration: 5 + random() * 4,
    offset: random(),
    reach: 0.15 + random() * 0.45,
    theta0: random() * Math.PI * 2,
    omega: (random() * 2 - 1) * 1.2,
    swirl: 2 + random() * 3,
    rise: 0.1 + random() * 0.35,
    sway: 0.02 + random() * 0.03,
    swayFreq: 0.4 + random() * 0.6,
    swayPhase: random() * Math.PI * 2,
    spin: random() * 25,
    spinFreq: 0.5 + random() * 0.8,
  }));
}

export function TornadoText() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const fonts = useMemo(() => {
    const fontFamily = Platform.select({ ios: 'Times New Roman', default: 'serif' });
    return [width / 42, width / 30, width / 22].map((size) =>
      matchFont({ fontFamily, fontSize: Math.max(8, Math.round(size)) }),
    );
  }, [width]);

  // widthTable[tier][word] = advance width of that word at that size.
  const widthTable = useMemo(
    () => fonts.map((font) => WORDS.map((word) => font.getTextWidth(word))),
    [fonts],
  );

  const particles = useMemo(() => makeParticles(), []);

  const picture = useDerivedValue(() => {
    const cx = width / 2;
    const cy = height / 2;
    const focal = width * FOCAL_SCALE;
    const t = clock.value / 1000;

    return createPicture((canvas) => {
      'worklet';
      const paper = Skia.Paint();
      paper.setColor(Skia.Color(BACKGROUND));
      canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paper);

      const ink = Skia.Paint();
      ink.setColor(Skia.Color('#000000'));

      // Two passes: particles on the far side first, then the near side on top.
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < particles.length; k++) {
          const q = particles[k];
          const p = (t / q.duration + q.offset) % 1; // 0 = born at center, 1 = gone
          const e = 1 - Math.pow(1 - p, 3); // ease-out: burst fast, then drift
          const radius = q.reach * width * e;
          const theta = q.theta0 + q.omega * t + q.swirl * p;
          const cos = Math.cos(theta);
          const isFront = cos >= 0;
          if ((pass === 0) === isFront) {
            continue;
          }

          const z = radius * cos;
          const s = focal / (focal - z);
          const amp = q.sway * width * p;
          const drift = Math.sin(t * q.swayFreq + q.swayPhase) * amp;
          const bob = Math.cos(t * q.swayFreq * 0.8 + q.swayPhase * 1.3) * amp;
          const x = cx + radius * Math.sin(theta) * s + drift;
          const y = cy + (-q.rise * height * p) * s + bob;

          const fadeIn = Math.min(1, p / 0.08);
          const fadeOut = Math.min(1, (1 - p) / 0.25);
          const depth = (cos + 1) / 2; // 0 = far, 1 = near
          ink.setAlphaf(fadeIn * fadeOut * (0.2 + 0.8 * depth));

          const size = (0.35 + 0.65 * e) * s;
          const squash = 0.4 + 0.6 * Math.abs(cos);
          const tilt = Math.sin(t * q.spinFreq + q.swayPhase) * q.spin;
          const w = widthTable[q.tier][q.word];

          canvas.save();
          canvas.translate(x, y);
          canvas.rotate(tilt, 0, 0);
          canvas.scale(size * squash, size);
          canvas.drawText(WORDS[q.word], -w / 2, 0, ink, fonts[q.tier]);
          canvas.restore();
        }
      }
    }, Skia.XYWHRect(0, 0, width, height));
  });

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Picture picture={picture} />
    </Canvas>
  );
}
