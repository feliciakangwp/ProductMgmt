// A stand-in for the Anthropic Messages API used by the end-to-end tests, so
// the real API server and SDK code path run without network access or an
// API key. It answers with the reference debt write-off fixtures, choosing the
// task from the requested output schema.
import http from 'node:http';
import {
  DEBT_WRITE_OFF_ANALYSIS,
  deliveryAnswerFor,
  fieldSuggestionsForPrompt,
  OUTSTANDING_AMOUNT_TRANSLATION,
} from '@productflow/domain/testing';

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end('{"type":"error","error":{"type":"not_found_error","message":"not found"}}');
        return;
      }
      const request = JSON.parse(body) as {
        model: string;
        messages: { content: string }[];
        output_config?: { format?: { type: string; schema?: { properties?: Record<string, unknown> } } };
      };
      if (request.output_config?.format?.type !== 'json_schema') {
        res
          .writeHead(400, { 'content-type': 'application/json' })
          .end('{"type":"error","error":{"type":"invalid_request_error","message":"expected json_schema output"}}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_mock' }).end(
        JSON.stringify({
          id: 'msg_mock',
          type: 'message',
          role: 'assistant',
          model: request.model,
          content: [{ type: 'text', text: JSON.stringify(answerFor(request)) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 812, output_tokens: 1420 },
        }),
      );
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`mock Anthropic API on http://127.0.0.1:${port}`));

function answerFor(request: {
  messages: { content: string }[];
  output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } };
}): unknown {
  const properties = request.output_config?.format?.schema?.properties ?? {};
  const delivery = deliveryAnswerFor(properties, request.messages[0]?.content ?? '');
  if (delivery) return delivery;
  if ('activities' in properties) return fieldSuggestionsForPrompt(request.messages[0]?.content ?? '');
  if ('rules' in properties) return OUTSTANDING_AMOUNT_TRANSLATION;
  return DEBT_WRITE_OFF_ANALYSIS;
}
