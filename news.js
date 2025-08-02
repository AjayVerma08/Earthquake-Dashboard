document.addEventListener("DOMContentLoaded", () => {
  const newsContainer = document.querySelector(".recent-news");

  // Check if container exists
  if (!newsContainer) {
    console.error("Missing .recent-news container in HTML");
    return;
  }

  // Create Load More button
  const loadMoreBtn = document.createElement("button");
  loadMoreBtn.textContent = "Load More";
  loadMoreBtn.className = "load-more-news";
  loadMoreBtn.style.display = "none"; // initially hidden
  newsContainer.after(loadMoreBtn);

  let allArticles = [];
  let currentIndex = 0;
  const articlesPerPage = 4;

  async function fetchEarthquakeNews() {
    try {
      const res = await fetch('/.netlify/functions/getNews');
      const { articles } = await res.json();

      if (!articles || articles.length === 0) {
        newsContainer.innerHTML = "<p>No recent earthquake news found.</p>";
        return;
      }

      allArticles = articles;
      currentIndex = 0;
      newsContainer.innerHTML = "";
      renderArticles();

      if (allArticles.length > articlesPerPage) {
        loadMoreBtn.style.display = "block";
      }
    } catch (error) {
      console.error("News fetch failed:", error);
      newsContainer.innerHTML = "<p>Error loading news articles.</p>";
    }
  }

  function renderArticles() {
    const nextBatch = allArticles.slice(currentIndex, currentIndex + articlesPerPage);

    nextBatch.forEach(article => {
      const newsCard = document.createElement("div");
      newsCard.className = "news-holder col-lg-2";

      newsCard.innerHTML = `
        <h3 class="news-title" style="font-size: 1.5rem; padding: 10px;">
          <a href="${article.url}" target="_blank" style="text-decoration: none; color: black;">
            ${article.title}
          </a>
        </h3>
        <p style="font-size: 1rem;">${article.description || "No summary available."}</p>
        <p style="font-size: 0.75rem; color: gray;">
          ${new Date(article.publishedAt).toLocaleString()}
        </p>
      `;
      newsContainer.appendChild(newsCard);
    });

    currentIndex += articlesPerPage;

    if (currentIndex >= allArticles.length) {
      loadMoreBtn.style.display = "none";
    }
  }

  loadMoreBtn.addEventListener("click", renderArticles);
  fetchEarthquakeNews();
});
