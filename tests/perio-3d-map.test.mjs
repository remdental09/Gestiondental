import test from 'node:test';
import assert from 'node:assert/strict';
import { periodontalMarkers } from '../app/perio-3d-map.ts';

const outline = { left: -0.5, right: 0.5, front: 0.4, back: -0.4 };

test('seis sondas ocupan caras y posiciones correctas en ambas hemiarcadas', () => {
  const right = periodontalMarkers(16, outline, {});
  const left = periodontalMarkers(26, outline, {});
  assert.deepEqual(right.map(marker => marker.key), ['MV', 'V', 'DV', 'ML', 'L', 'DL']);
  assert.equal(right.length, 6);
  assert.ok(right[0].x > right[2].x);
  assert.ok(left[0].x < left[2].x);
  assert.ok(right.slice(0, 3).every(marker => marker.z > 0));
  assert.ok(right.slice(3).every(marker => marker.z < 0));
  assert.ok(right.every(marker => marker.color === 0x94a3b8));
});

test('las lecturas sintéticas se distinguen sin convertir sin medir en sano', () => {
  const depths = [0, 3, 4, 5, 6, null];
  const sites = Object.fromEntries(['MV', 'V', 'DV', 'ML', 'L', 'DL'].map((key, index) => [key, { depth: depths[index], margin: null, bleeding: index === 4, suppuration: index === 3 }]));
  const markers = periodontalMarkers(36, outline, sites);
  assert.deepEqual(markers.map(marker => marker.color), [0x047857, 0x047857, 0xb45309, 0xb45309, 0xbe123c, 0x94a3b8]);
  assert.equal(markers[4].bleeding, true);
  assert.equal(markers[3].suppuration, true);
  assert.equal(markers[5].length, 0.07);
  assert.ok(markers[4].length > markers[1].length);
});
