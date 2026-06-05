import { TQuestion } from '@/common/types';
import { QuestionType } from '@/db/schemas/question.schema';

export function buildQuestionBody(question: TQuestion): string {
  if (
    question.questionType === QuestionType.Mcqs ||
    question.questionType === QuestionType.Closed
  ) {
    return `Question stem: "${question.stem}"
Options:
${question.options.map((o, i) => `  ${i}. ${o}`).join('\n')}
Correct answer index: ${question.correctAnswerIndex}
Explanation: "${question.explanation}"`;
  }
  if (question.questionType === QuestionType.Grouped) {
    const childLines = question.childQuestions
      .map(
        (c, idx) =>
          `  Child ${idx + 1}: "${c.stem}"\n  Options: ${c.options.map((o, i) => `${i}. ${o}`).join(', ')}\n  Correct index: ${c.correctAnswerIndex}`,
      )
      .join('\n');
    return `Question stem: "${question.stem}"
Child questions:
${childLines}`;
  }
  return `Question stem: "${question.stem}"
Solution: "${question.solution}"`;
}
