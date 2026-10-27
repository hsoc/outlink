import { base64urlnopad } from '@scure/base';
const C = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
export const proof = { amount: 2, id: '009a1f293253e41e', secret: 'a'.repeat(64), C };
export const encoded = (proofs = [proof], mint = 'https://mint.example', unit = 'sat') => 'cashuA' + base64urlnopad.encode(new TextEncoder().encode(JSON.stringify({ token: [{ mint, proofs }], unit })));
