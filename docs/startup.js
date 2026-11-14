try {
 await import('./app.js?v=2a96e4f38bd2');
} catch (error) {
 console.error('Sharework startup failed',error);
 const message=document.getElementById('auth-error');
 const english=localStorage.getItem('sw.language')==='en';
 message.textContent=english?'Sharework could not load. Reload the page or open it in Chrome.':'Sharework non si è caricato. Ricarica la pagina oppure aprila in Chrome.';
 document.getElementById('auth-submit').disabled=true;
}
