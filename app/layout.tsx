import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'На струнах — ваш гитарный вечер',description:'Соберите песни в сетлист и играйте: аккорды, очередь исполнения и собственная CSV-библиотека.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}
