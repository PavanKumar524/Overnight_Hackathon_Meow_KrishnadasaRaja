// ===== Event Tracker =====
  class EventTracker {
    constructor(sessionId){
      this.sessionId = sessionId || Math.random().toString(36).slice(2,12);
      this.events = [];
      this.startTime = Date.now();
      this.lastKeyTime = null;
      this.init();
    }
    init(){
      document.addEventListener('mousemove', e => this.trackMouse(e));
      document.addEventListener('click', e => this.trackClick(e));
      document.addEventListener('keydown', e => this.trackKeyDown(e));
      document.addEventListener('keyup', e => this.trackKeyUp(e));
      window.addEventListener('blur', () => this.trackBlur());
      window.addEventListener('focus', () => this.trackFocus());
    }
    getTimestamp(){ return Date.now() - this.startTime; }
    trackMouse(e){
      this.events.push({type:'mousemove', x:e.clientX, y:e.clientY, timestamp:this.getTimestamp()});
    }
    trackClick(e){
      this.events.push({type:'click', x:e.clientX, y:e.clientY, button:e.button, timestamp:this.getTimestamp()});
      log(`Click at (${e.clientX}, ${e.clientY})`);
    }
    trackKeyDown(e){
      const now = Date.now();
      const dt = this.lastKeyTime ? now - this.lastKeyTime : 0;
      this.events.push({type:'keydown', key:e.key, code:e.code, timeSinceLastKey:dt, timestamp:this.getTimestamp()});
      log(`Key event recorded`); 
    }
    trackKeyUp(e){
      this.lastKeyTime = Date.now();
      this.events.push({type:'keyup', key:e.key, timestamp:this.getTimestamp()});
    }
    trackBlur(){
      this.events.push({type:'blur', timestamp:this.getTimestamp()});
      log('⚠️ Window lost focus (blur event) - RISK SPIKE');
    }
    trackFocus(){
      this.events.push({type:'focus', timestamp:this.getTimestamp()});
      log('✅ Window gained focus (focus event)');
    }
    getEvents(){ return this.events; }
    getEventsByType(type){ return this.events.filter(e => e.type === type); }
    
    getStats(){
      return {
        totalEvents: this.events.length,
        mouseMoves: this.getEventsByType('mousemove').length,
        clicks: this.getEventsByType('click').length,
        keyDowns: this.getEventsByType('keydown').length,
        keyUps: this.getEventsByType('keyup').length,
        blurs: this.getEventsByType('blur').length,
        focuses: this.getEventsByType('focus').length,
        durationMs: Date.now() - this.startTime
      };
    }
  }

  const tracker = new EventTracker();

  // ===== Helpers =====
  function log(msg){
    const el = document.getElementById('output');
    const t = new Date().toLocaleTimeString();
    el.innerHTML += `[${t}] ${msg}<br>`;
    el.scrollTop = el.scrollHeight;
  }

  // ===== Export to Excel (CSV) =====
  function exportToExcel(){
    const events = tracker.getEvents();
    // CSV Header
    let csvContent = "Timestamp (ms),Event Type,Details\n";
    
    // Process rows
    events.forEach(e => {
      let details = "";
      if(e.type === 'mousemove' || e.type === 'click'){
        details = `x: ${e.x} | y: ${e.y}`;
      } else if (e.type === 'keydown' || e.type === 'keyup'){
        // Escape commas in keys just in case
        details = `Key: ${e.key}`;
      } else if (e.type === 'blur'){
        details = "Tab/Window Switched OUT";
      } else if (e.type === 'focus'){
        details = "Tab/Window Switched IN";
      }
      
      csvContent += `${e.timestamp},${e.type},"${details}"\n`;
    });

    // Create Blob with Excel-compatible BOM
    const blob = new Blob(["\uFEFF"+csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "proctoring_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    log('📊 Excel (CSV) file downloaded.');
  }

  // ===== Quiz Logic =====
  const ANSWERS = { q1:'b', q2:'a', q3:'b', q4:'c', q5:'c' };

  function gradeQuiz(form){
    let score = 0, total = 5, unanswered = [];
    Object.keys(ANSWERS).forEach((k, i) => {
      const sel = form.querySelector(`input[name="${k}"]:checked`);
      if(!sel){ unanswered.push(i+1); return; }
      if(sel.value === ANSWERS[k]) score++;
    });
    return { score, total, unanswered };
  }

  // ===== Risk Model =====
  function computeRiskFromStats(stats){
    const wMouse = 0.025, wKeys = 0.10;
    // CRITICAL UPDATE: Blur weight set to 80. 
    // This ensures a single blur (1 * 80) crosses the 75 threshold immediately.
    const wBlur = 70; 

    const rMouse = Math.min(30, stats.mouseMoves * wMouse);
    const rKeys  = Math.min(30, stats.keyDowns  * wKeys);
    const rBlur  = Math.min(100, stats.blurs     * wBlur); // Allow blur to max out score
    
    const raw = rMouse + rKeys + rBlur;
    return Math.min(100, Math.round(raw));
  }

  // ===== Render (post-submission) =====
  function renderPostSubmission(stats, quizResult){
    const quizBox = document.getElementById('quizScoreBox');
    if(quizResult.unanswered.length){
      quizBox.innerHTML = `Quiz Score: ${quizResult.score}/${quizResult.total}  <span class="pill warn">Unanswered: ${quizResult.unanswered.join(', ')}</span>`;
    } else {
      quizBox.innerHTML = `Quiz Score: ${quizResult.score}/${quizResult.total}  <span class="pill ok">Submitted</span>`;
    }

    const risk = computeRiskFromStats(stats);
    const riskEl = document.getElementById('riskDisplay');
    const badge =
      risk >= 80 ? `<span class="pill danger">High Risk / Auto-Fail</span>` :
      risk >= 50 ? `<span class="pill warn">Elevated risk</span>` :
                   `<span class="pill ok">Low risk</span>`;

    riskEl.innerHTML = `\n<strong>🚨 Behavior Risk Score:</strong> ${risk}/100 ${badge}`;
  }

  // ===== Auto-check and Warning system =====
  let warned50 = false, warned65 = false, autoSubmitted = false;

  function updateMonitoring(){
    const stats = tracker.getStats();
    const risk = computeRiskFromStats(stats);
    const wa = document.getElementById('warningArea');

    // Clear previous warnings to avoid duplicates
    wa.innerHTML = '';

    // Warning at 50
    if(risk >= 50 && risk < 75 && !autoSubmitted){
      if(!warned50) { warned50 = true; log('⚠️ Warning issued (>=50)'); }
      
      const div = document.createElement('div');
      div.className = 'warning-box warning-1';
      div.innerHTML = `<strong>Warning:</strong> Risk score is ${risk}/100. Avoid mouse jitter or suspicious key activity.`;
      wa.appendChild(div);
    }

    // Auto-submit at 75 (Immediate on tab switch because Blur weight is 80)
    if(risk >= 75 && !autoSubmitted){
      autoSubmitted = true;
      log('⏳ Risk >= 75 (Tab switched or high activity) — auto-submitting.');
      const div = document.createElement('div');
      div.className = 'warning-box warning-2';
      div.innerHTML = `<strong>Terminated:</strong> Risk score reached ${risk}/100. Quiz auto-submitted.`;
      wa.appendChild(div);
      
      doSubmit(true);
    }
  }

  // Monitor every 1 second
  setInterval(updateMonitoring, 1000);

  // ===== Submit handler =====
  function doSubmit(isAuto){
    if(document.getElementById('resultsPanel').classList.contains('hidden') === false && isAuto){
      return; 
    }

    const form = document.getElementById('quizForm');
    const res = gradeQuiz(form);
    const stats = tracker.getStats();

    document.getElementById('resultsPanel').classList.remove('hidden');
    document.getElementById('preSubmitBadge').classList.add('hidden');

    renderPostSubmission(stats, res);

    // Disable inputs after submit
    const inputs = form.querySelectorAll('input');
    inputs.forEach(i => i.disabled = true);
    document.getElementById('submitBtn').style.display = 'none';

    log(`${isAuto ? '🔔 Auto' : '🔒 Manual'} submission performed.`);
  }

  // ===== Wire up buttons =====
  document.getElementById('submitBtn').addEventListener('click', () => doSubmit(false));
  document.getElementById('excelBtn').addEventListener('click', exportToExcel);

  log('✨ Proctored Quiz initialized. STRICT MODE.');