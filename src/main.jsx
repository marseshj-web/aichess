import React from 'react'
import ReactDOM from 'react-dom/client'
import ChessEngine from '../chess-stockfish-engine.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChessEngine />
  </React.StrictMode>
)
