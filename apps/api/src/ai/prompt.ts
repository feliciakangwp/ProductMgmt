// The analysis prompt lives in the domain package so every client of the
// analysis (this API and the in-browser demo) sends the same instructions.
export { buildRetryMessage, buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from '@productflow/domain';
