const fetch = require('node-fetch');

exports.handler = async function (event, context) {
  const NEWS_API_KEY = process.env.NEWS_API_KEY;

  const today = new Date().toISOString().split('T')[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const url = `https://newsapi.org/v2/everything?q=earthquake&from=${oneWeekAgo}&to=${today}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.articles || data.articles.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ articles: [] }),
      };
    }

    const strongKeywords = [
      "magnitude", "richter", "aftershock", "rescue", "tsunami",
      "evacuation", "collapsed", "killed", "death", "disaster"
    ];

    let filtered = data.articles.filter(article => {
      const title = (article.title || "").toLowerCase();
      const desc = (article.description || "").toLowerCase();
      const content = (article.content || "").toLowerCase();

      return strongKeywords.some(keyword =>
        title.includes(keyword) ||
        desc.includes(keyword) ||
        content.includes(keyword)
      );
    });

    const seen = new Set();
    filtered = filtered.filter(article => {
      const title = (article.title || "")
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .split(' ')
        .slice(0, 10)
        .join(' ');

      if (seen.has(title)) return false;
      seen.add(title);
      return true;
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ articles: filtered.slice(0, 4) }),
    };
  } catch (err) {
    console.error("🔴 Error fetching news:", err); // <-- KEY LINE
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch news." }),
    };
  }
};
