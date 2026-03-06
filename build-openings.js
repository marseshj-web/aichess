import https from 'https';
import fs from 'fs';
import path from 'path';
import { Chess } from 'chess.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dl = (url) => new Promise((res, rej) => {
  https.get(url, response => {
    if (response.statusCode !== 200) return rej('Failed: ' + response.statusCode);
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => res(data));
  }).on('error', rej);
});

(async () => {
  try {
    const codes = ['a', 'b', 'c', 'd', 'e'];
    const openingsDict = {};
    let count = 0;

    for (const code of codes) {
      console.log(`Downloading ${code}.tsv...`);
      const content = await dl(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${code}.tsv`);
      const lines = content.split('\n').slice(1);
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const [eco, name, pgn] = line.split('\t');
        if (eco && name && pgn) {
          try {
            const chess = new Chess();
            chess.loadPgn(pgn);
            // We only need the board position part of the FEN (before the move counters)
            // e.g., "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
            let fen = chess.fen();
            const fenParts = fen.split(' ');
            fenParts.pop(); // Remove fullmove
            fenParts.pop(); // Remove halfmove
            const shortFen = fenParts.join(' ');
            
            // Overwrite if same FEN but we prefer shorter/main names or just keep the last one.
            // Actually, for ECO, we want to keep the most specific one if multiple match, 
            // but Lichess TSV is ordered roughly from general to specific.
            openingsDict[shortFen] = { eco, name };
            count++;
          } catch (e) {
            // Ignore invalid PGNs
          }
        }
      }
    }
    
    const dbPath = path.join(__dirname, 'public', 'openings.json');
    fs.writeFileSync(dbPath, JSON.stringify(openingsDict));
    console.log(`Successfully parsed and saved ${Object.keys(openingsDict).length} unique openings to public/openings.json`);
  } catch (err) {
    console.error(err);
  }
})();