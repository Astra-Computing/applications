import { Quote } from '@/lib/types';

interface Props {
  quote: Quote;
  selected?: boolean;
  showAuthor?: boolean;
}

// Returns true if the text already contains any double-quote character
// (ASCII 0x22, left curly 0x201C, right curly 0x201D)
function containsQuoteChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x201C || c === 0x201D) return true;
  }
  return false;
}

export default function QuoteCard({ quote, selected = false, showAuthor = false }: Props) {
  const isMultiline = quote.text.includes('\n');
  const hasQuotes = containsQuoteChar(quote.text);

  return (
    <div className={`quote-card${selected ? ' selected' : ''}`}>
      <div className="quote-text">
        {isMultiline
          ? quote.text.split('\n').map((line, i) => (
              <span key={i}>{line}{i < quote.text.split('\n').length - 1 && <br />}</span>
            ))
          : hasQuotes ? <>{quote.text}</> : <>{'“'}{quote.text}{'”'}</>
        }
      </div>
      {showAuthor && quote.author && quote.author !== 'Unknown' && (
        <div className="quote-author">{'—'} {quote.author}</div>
      )}
    </div>
  );
}
