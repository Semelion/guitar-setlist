export type SwipeMode = 'select' | 'play';
export type SwipeDir = 'left' | 'right' | null;
export const SWIPE_THRESHOLD=80;
export const SWIPE_RATIO=1.4;
export const SWIPE_MIN_MOVE=10;
export function decideSwipe(dx:number,dy:number,mode:SwipeMode):SwipeDir{if(mode!=='select'&&mode!=='play')return null;return Math.abs(dx)>=SWIPE_THRESHOLD&&Math.abs(dx)>Math.abs(dy)*SWIPE_RATIO?(dx>0?'right':'left'):null;}
export function swipeAction(dir:SwipeDir,mode:SwipeMode):string|null{return !dir?null:mode==='select'?(dir==='right'?'add':'skip'):(dir==='right'?'done':'later');}
export function swipeTransform(dx:number):string{return 'translateX('+dx+'px) rotate('+Math.max(-12,Math.min(12,dx/14))+'deg)';}
export function swipeHint(dir:SwipeDir,mode:SwipeMode):string{return !dir?'':mode==='select'?(dir==='right'?'В плейлист':'Пропустить'):(dir==='right'?'Сыграли!':'В конец очереди');}
