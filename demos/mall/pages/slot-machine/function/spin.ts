/*@luban-method
{
  "name": "spin",
  "params": [],
  "returnType": "void"
}
*/

if (spinning === true) { return; }
setData('spinning', true);

const pool = emojiPool;
let step = 0;
const totalSteps = 20;

function doStep() {
  if (step >= totalSteps) {
    setData('spinning', false);
    checkWin();
    return;
  }
  const newCells = [];
  for (let i = 0; i < 9; i++) {
    const ri = Math.floor(Math.random() * pool.length);
    newCells.push({ emoji: pool[ri], index: i });
  }
  setData('cells', newCells);
  step++;
  const delay = 40 + step * 8;
  setTimeout(doStep, delay);
}

doStep();

function checkWin() {
  const c = cells;
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  let winCount = 0;
  for (let li = 0; li < lines.length; li++) {
    const [a, b, d] = lines[li];
    if (c[a].emoji === c[b].emoji && c[b].emoji === c[d].emoji) {
      winCount++;
    }
  }
  if (winCount > 0) {
    const bonus = winCount * 100;
    setData('score', score + bonus);
    showToast('🎉 中了 ' + winCount + ' 条线！+ ' + bonus + ' 分', 'long');
  } else {
    showToast('😢 没中奖，再试一次', 'short');
  }
}
