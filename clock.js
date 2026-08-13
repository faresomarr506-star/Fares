(() => {
  const tick = () => {
    const now = new Date(); const sec = now.getSeconds();
    const min = now.getMinutes() + sec / 60; const hour = (now.getHours() % 12) + min / 60;
    document.querySelectorAll('.hand-hour').forEach(e => e.style.transform = `rotate(${hour * 30}deg)`);
    document.querySelectorAll('.hand-minute').forEach(e => e.style.transform = `rotate(${min * 6}deg)`);
    document.querySelectorAll('.hand-second').forEach(e => e.style.transform = `rotate(${sec * 6}deg)`);
    const time = now.toLocaleTimeString('ar', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const date = now.toLocaleDateString('ar', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
    ['siteAnalogTime','panelClockTime'].forEach(id => { const e=document.getElementById(id); if(e)e.textContent=time });
    ['siteAnalogDate','panelClockDate'].forEach(id => { const e=document.getElementById(id); if(e)e.textContent=date });
  }; tick(); setInterval(tick, 1000);
})();
