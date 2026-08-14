'use strict'

class TicTacToe {
  constructor(playerX, secondMarker = 'o') {
    this.playerX = playerX
    this.playerO = secondMarker === 'o' ? null : secondMarker
    this.board = Array.from({ length: 9 }, (_, i) => String(i + 1))
    this.currentTurn = playerX
    this.turns = 0
    this.winner = null
  }

  render() {
    return this.board.slice()
  }

  turn(isPlayerO, index) {
    if (this.winner) return false
    if (!Number.isInteger(index) || index < 0 || index > 8) return false
    if (this.board[index] === 'X' || this.board[index] === 'O') return false
    const mark = isPlayerO ? 'O' : 'X'
    this.board[index] = mark
    this.turns += 1
    this.winner = this.detectWinner()
    if (!this.winner && this.playerO) this.currentTurn = isPlayerO ? this.playerX : this.playerO
    return true
  }

  detectWinner() {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ]
    for (const [a, b, c] of lines) {
      if (this.board[a] === this.board[b] && this.board[b] === this.board[c]) {
        return this.board[a] === 'X' ? this.playerX : this.playerO
      }
    }
    return null
  }
}

module.exports = TicTacToe
