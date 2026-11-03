export type WebQuestion = { id: string; question: string; options: { label: string; description?: string }[]; allowOther: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
// Whitelist the native item/tool/requestUserInput questions payload. Never infer options from prose.
export function projectQuestions(kind: string, details: unknown): WebQuestion[] | undefined {
  if (object(details) && details.method === 'item/tool/requestUserInput' && object(details.params)) details = details.params;
  if (kind !== 'question' || !object(details) || !Array.isArray(details.questions) || !details.questions.length || details.questions.length > 16) return;
  const ids = new Set<string>(), result: WebQuestion[] = [];
  for (const q of details.questions) {
    if (!object(q) || !text(q.id, 200) || ids.has(q.id) || !text(q.question, 16000) || q.isSecret === true || (q.isSecret !== undefined && typeof q.isSecret !== 'boolean') || (q.isOther !== undefined && typeof q.isOther !== 'boolean')) return;
    if (q.options != null && (!Array.isArray(q.options) || q.options.length > 100)) return;
    const options: WebQuestion['options'] = [], labels = new Set<string>();
    for (const o of (q.options ?? []) as unknown[]) {
      if (!object(o) || !text(o.label, 200) || labels.has(o.label) || (o.description != null && !text(o.description, 16000))) return;
      labels.add(o.label);
      options.push({ label: o.label, ...(typeof o.description === 'string' ? { description: o.description } : {}) });
    }
    ids.add(q.id); result.push({ id: q.id, question: q.question, options, allowOther: !options.length || q.isOther === true });
  }
  return result;
}
export function questionAnswerText(questions: WebQuestion[], answers: Record<string, string>): string {
  return questions.map((q, i) => `${i + 1}. ${q.question}\n答案：${typeof answers[q.id] === 'string' ? answers[q.id] : ''}`).join('\n\n');
}
// Only explicit native fields supply structure. Ordinary conversation stays text.
export function questionReply(questions:WebQuestion[],values:Record<string,string>,structured:boolean):{text:string;questionAnswers?:Record<string,string[]>}{
  if(questions.some(q=>!values[q.id]?.trim()||(!q.allowOther&&!q.options.some(o=>o.label===values[q.id]))))throw Error('interaction_answer_scope');
  const answers=Object.fromEntries(questions.map(q=>[q.id,[values[q.id]!]]));
  const text=questions.length===1&&questions[0]!.allowOther?values[questions[0]!.id]!:questionAnswerText(questions,values);
  if(text.length>16000)throw Error('invalid_message');
  return structured?{text,questionAnswers:answers}:{text:JSON.stringify(answers)};
}
