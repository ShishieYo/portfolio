(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Footer year
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Tenure calculation (public service started 2017) — static markup already
  // shows a correct value for today; this just keeps it accurate on future visits.
  const tenureEl = document.getElementById('tenureStat');
  if (tenureEl) {
    const years = new Date().getFullYear() - 2017;
    if (years > 0) tenureEl.textContent = `${years}+`;
  }

  // Sticky header state + scroll progress bar
  const header = document.getElementById('siteHeader');
  const progressBar = document.getElementById('scrollProgress');
  if (header || progressBar) {
    const onScroll = () => {
      if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
      if (progressBar) {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
        progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }

  // Mobile nav toggle
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');
  if (navToggle && mobileNav) {
    const closeMenu = () => {
      navToggle.setAttribute('aria-expanded', 'false');
      mobileNav.hidden = true;
    };
    navToggle.addEventListener('click', () => {
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isOpen));
      mobileNav.hidden = isOpen;
    });
    mobileNav.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileNav.hidden) {
        closeMenu();
        navToggle.focus();
      }
    });
  }

  // Smooth scroll with sticky-header offset
  const headerHeight = () => (header ? header.offsetHeight : 0);
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', function (evt) {
      const id = this.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      if (!section) return;
      evt.preventDefault();
      const targetY = window.pageYOffset + section.getBoundingClientRect().top - headerHeight() - 12;
      window.scrollTo({ top: targetY, behavior: reducedMotion ? 'auto' : 'smooth' });
      history.replaceState(null, '', `#${id}`);
    });
  });

  // Scroll-spy for primary nav
  const navLinks = document.querySelectorAll('.site-nav ul a[data-nav]');
  const spyTargets = Array.from(navLinks)
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (navLinks.length && spyTargets.length && 'IntersectionObserver' in window) {
    const spyObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = document.querySelector(`.site-nav ul a[href="#${entry.target.id}"]`);
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach((l) => l.removeAttribute('aria-current'));
            link.setAttribute('aria-current', 'true');
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    spyTargets.forEach((el) => spyObserver.observe(el));
  }

  // Scroll-reveal, progressive enhancement: elements are fully visible by
  // default in the HTML/CSS; JS only opts them into the hidden->fade-in
  // treatment, and a safety timeout guarantees nothing stays stuck hidden.
  if (!reducedMotion && 'IntersectionObserver' in window) {
    const revealTargets = document.querySelectorAll('.section, .case-study, .stat, .skills-group');
    revealTargets.forEach((el) => el.classList.add('reveal-ready'));
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    revealTargets.forEach((el) => revealObserver.observe(el));
    window.setTimeout(() => {
      document.querySelectorAll('.reveal-ready:not(.is-visible)').forEach((el) => el.classList.add('is-visible'));
    }, 3000);
  }

  // Count-up animation for Impact stat numbers. Reads the already-correct
  // rendered value (set statically in HTML, or by the tenure calc above) as
  // the animation target, rather than duplicating it in a data attribute.
  if (!reducedMotion && 'IntersectionObserver' in window) {
    const statEls = document.querySelectorAll('.stat-number');
    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          countObserver.unobserve(entry.target);
          const el = entry.target;
          const finalText = el.textContent.trim();
          const target = parseInt(finalText.replace(/[^\d]/g, ''), 10);
          const suffix = finalText.replace(/[\d,]/g, '');
          if (!Number.isFinite(target)) return;
          const duration = 1100;
          const start = performance.now();
          const step = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = Math.round(target * eased);
            el.textContent = value.toLocaleString('en-US') + suffix;
            if (progress < 1) requestAnimationFrame(step);
            else el.textContent = finalText;
          };
          requestAnimationFrame(step);
        });
      },
      { threshold: 0.6 }
    );
    statEls.forEach((el) => countObserver.observe(el));
  }

  // Certification badge images: fall back to a simple icon if the badge
  // host is ever unreachable, instead of showing a broken-image glyph.
  document.querySelectorAll('.cert-icon img').forEach((img) => {
    img.addEventListener('error', () => img.closest('.cert-icon').classList.add('has-error'), { once: true });
  });

  // Magnetic hover on buttons — subtle pull toward the cursor. Desktop with
  // a precise pointer only; skipped entirely on touch or reduced-motion.
  if (!reducedMotion && window.matchMedia('(pointer: fine)').matches) {
    const MAGNET_STRENGTH = 0.25;
    const MAGNET_MAX = 8;
    document.querySelectorAll('.btn').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const relX = e.clientX - (rect.left + rect.width / 2);
        const relY = e.clientY - (rect.top + rect.height / 2);
        const x = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, relX * MAGNET_STRENGTH));
        const y = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, relY * MAGNET_STRENGTH));
        btn.style.transform = `translate(${x}px, ${y}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  // Contact form submission
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = form.action || '';
      const msgEl = document.getElementById('formMsg');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (!url) {
        if (msgEl) msgEl.textContent = 'Form not configured. Please try again later.';
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch(url, { method: 'POST', body: new FormData(form) });
        if (res.ok) {
          if (msgEl) msgEl.textContent = 'Thanks — I received your message and will reply within 24–48 hours.';
          form.reset();
        } else if (msgEl) {
          msgEl.textContent = 'There was an issue sending the message. Please try again later.';
        }
      } catch (err) {
        if (msgEl) msgEl.textContent = 'Network error — please try again later.';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  console.log('%cStill debugging in production — like everyone else.', 'color:#2C5778;font-weight:600;font-size:12px;');
})();
