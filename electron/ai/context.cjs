// 装配「环境上下文」:每次对话现拼一段 system 提示,让酒狐反应更自然。
// Phase 1:当前时间 + 她自己的状态。Phase 2 再加 活动窗口 / 截图分析。

const settings = require('./settings.cjs');

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function timeStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  let part = '深夜';
  const h = d.getHours();
  if (h >= 5 && h < 11) part = '早上';
  else if (h >= 11 && h < 13) part = '中午';
  else if (h >= 13 && h < 18) part = '下午';
  else if (h >= 18 && h < 23) part = '晚上';
  return `现在是 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${hh}:${mm}(${part})`;
}

function stateStr(state) {
  if (!state) return '';
  const bits = [];
  if (state.sitting) bits.push('你正坐着');
  if (state.dragging) bits.push('主人正拖着你');
  if (typeof state.winScale === 'number' && state.winScale !== 1) {
    bits.push(`你当前被缩放到 ${state.winScale.toFixed(2)} 倍`);
  }
  return bits.length ? `你此刻的状态:${bits.join('、')}。` : '';
}

// 动画标记提示:让模型可在回复末尾用 [anim:TAG] 表达情绪动作。渲染层会剥掉标记并触发动画。
// 受 showAnimTags 约束(与文字动作描述 showActions 独立控制)。
function animTagHint() {
  if (settings.getAll().showAnimTags === false) return '';
  return '你可以在回复末尾用情绪动作标记(可选,不想动就不加):[anim:cute](卖萌)、[anim:happy](开心)、[anim:sad](难过)、[anim:eat](吃东西)、[anim:drink](喝东西)、[anim:wave](打招呼)、[anim:clap](鼓掌)、[anim:dance](跳舞)、[anim:sit](坐下)、[anim:stand](站起)。可以放多个,会按顺序依次播放。标记单独放在最后,不要解释它,也不要在正文里提它。';
}

// 心情标记提示:仅「原版」随机风格生效(该风格用 mood 加权挑选自发动作)。
// 让模型可用 [mood:N] 设定酒狐当前心情指数,影响她接下来自发小动作的倾向。
function moodHint() {
  if (settings.getAll().randomStyle !== 'classic') return '';
  return '你可以用心情标记设定酒狐此刻的心情指数(会影响她接下来自发小动作的倾向):[mood:N],N 为 0~100 的整数;偏高(50~100)更开心活泼,偏低(0~50)更低落消沉。想调就把它单独放在回复末尾,不解释也不在正文提它;不想调可以不加。';
}

// 返回一条 system 内容;放在 persona 之后、历史之前。
function buildEnvContext(state) {
  const lines = ['[环境信息,供你自然融入回应,不必刻意复述]', timeStr()];
  const s = stateStr(state);
  if (s) lines.push(s);
  const hint = animTagHint();
  if (hint) lines.push(hint);
  const mh = moodHint();
  if (mh) lines.push(mh);
  return lines.join('\n');
}

module.exports = { buildEnvContext, animTagHint, moodHint };
