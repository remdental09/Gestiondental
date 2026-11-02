import test from 'node:test';
import assert from 'node:assert/strict';
import { correctWithOpenAi } from '../lib/dictation/openai-correction.ts';

test('usa OpenAI para corregir texto clínico y valida cambios seguros', async () => {
  const result = await correctWithOpenAi('Caries mecial en pieza FDI 3.6.', 'test-secret', {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer test-secret');
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'gpt-4o-mini');
      assert.match(request.messages[1].content, /pieza FDI 3\.6/);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ text: 'Caries mesial en pieza FDI 3.6.' }) } }] });
    },
  });

  assert.equal(result.text, 'Caries mesial en pieza FDI 3.6.');
  assert.doesNotMatch(JSON.stringify(result), /test-secret/);
  assert.equal(result.corrections.length, 1);
  assert.equal(result.corrections[0].applied, true);
});

test('rechaza la respuesta de OpenAI si altera el número de pieza', async () => {
  const result = await correctWithOpenAi('Caries mesial en pieza FDI 3.6.', 'test-secret', {
    fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ text: 'Caries mesial en pieza FDI 3.5.' }) } }] }),
  });

  assert.equal(result.text, 'Caries mesial en pieza FDI 3.6.');
  assert.equal(result.corrections[0].applied, false);
  assert.match(result.corrections[0].reason, /números o piezas/);
});

test('no expone la clave ni acepta respuestas vacías del proveedor', async () => {
  await assert.rejects(
    correctWithOpenAi('Texto clínico.', 'test-secret', {
      fetcher: async (_url, init) => {
        assert.equal(init.headers.Authorization, 'Bearer test-secret');
        return Response.json({ choices: [{ message: { content: '' } }] });
      },
    }),
    /no devolvió texto corregido/,
  );
});
