export const workStates=[
 ['pending','Da iniziare'],['started','Iniziato'],['paused','Sospeso'],['completed','Terminato']
];

export function workState(work,now=Date.now()){
 if(work.work_status)return work.work_status;
 if(!work.work_start&&!work.work_end)return Object.hasOwn(work,'work_status')?'pending':'started';
 const start=work.work_start?Date.parse(work.work_start):-Infinity;
 const end=work.work_end?Date.parse(work.work_end):Infinity;
 return now>=start&&now<end?'started':'pending';
}

export function localDateTime(value){
 if(!value)return '';
 const date=new Date(value);
 return new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
