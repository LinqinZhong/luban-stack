/*@luban-method
{
  "name": "startSpin",
  "params": [],
  "returnType": "void"
}
*/

if (spinning === true) {
    return;
}
if (chances <= 0) {
    setData('hintText', '次数已用完');
    showToast('次数已用完', 'short');
    return;
}
setData('chances', chances - 1);
setData('spinning', true);
setData('hintText', '抽奖中...');

const rotationOrder = [0, 1, 2, 5, 8, 7, 6, 3];
const prizeToPos = [0, 1, 2, 3, 5, 6, 7, 8];
const targetPrize = Math.floor(Math.random() * 8);
const targetPos = prizeToPos[targetPrize];

const currentPos = activeIndex;
const startOffset = currentPos >= 0 ? rotationOrder.indexOf(currentPos) : 0;

const baseSteps = rotationOrder.length * 2;
const targetIndex = rotationOrder.indexOf(targetPos);
const extraSteps = ((targetIndex - startOffset + rotationOrder.length) % rotationOrder.length) + 1;
const totalSteps = baseSteps + extraSteps;

let currentStep = 0;
let delay = 60;

function nextStep() {
    if (currentStep >= totalSteps) {
        setData('spinning', false);
        const prize = prizes[targetPrize];
        setData('hintText', '恭喜获得：' + prize.emoji + ' ' + prize.name);
        showToast('恭喜获得：' + prize.emoji + ' ' + prize.name, 'long');
        return;
    }
    const idx = (startOffset + currentStep) % rotationOrder.length;
    const pos = rotationOrder[idx];
    setData('activeIndex', pos);
    if (currentStep > totalSteps - 8) {
        delay = delay + 40;
    }
    currentStep = currentStep + 1;
    setTimeout(nextStep, delay);
}

nextStep();
