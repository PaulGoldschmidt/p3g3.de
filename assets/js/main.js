(function () {
    // === Theme Toggle ===
    var btn = document.querySelector(".theme-toggle");
    var word = btn ? btn.querySelector(".theme-word") : null;

    function updateThemeWord() {
        if (!word) return;
        var current = document.documentElement.getAttribute("data-theme");
        word.textContent = current === "light" ? "light" : "dark";
    }

    function toggleTheme() {
        var current = document.documentElement.getAttribute("data-theme");
        var next = current === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
        if (window.__applyBgColor) window.__applyBgColor();
        updateThemeWord();
    }

    if (btn) {
        updateThemeWord();
        btn.addEventListener("click", toggleTheme);
    }

    // === Page Load Animation ===
    var navType = window.performance && window.performance.getEntriesByType
        ? window.performance.getEntriesByType("navigation")[0]
        : null;

    if (navType && navType.type === "navigate") {
        document.documentElement.classList.add("animate-appear");
    }

    // === Mobile Menu Toggle ===
    var burger = document.querySelector(".gh-burger");
    var head = document.querySelector(".gh-head");

    if (burger && head) {
        burger.addEventListener("click", function () {
            head.classList.toggle("is-open");
        });
    }

    // === Responsive video embeds ===
    var videos = document.querySelectorAll(
        'iframe[src*="youtube.com"], iframe[src*="vimeo.com"], iframe[src*="player."]'
    );
    videos.forEach(function (video) {
        if (!video.parentElement.classList.contains("kg-video-card")) {
            video.style.aspectRatio = "16 / 9";
            video.style.width = "100%";
            video.style.height = "auto";
        }
    });
})();
