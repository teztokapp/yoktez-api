import { load } from "cheerio";
import abdDisciplines from "./abdDisciplines.json" with { type: "json" };
import { sampleTheses } from "./sampleTheses.js";

const CACHE_TTL_MS = 1000 * 60 * 15;
const DETAIL_CACHE_TTL_MS = 1000 * 60 * 60;
const cache = new Map();
const scraperBaseUrl = process.env.SCRAPER_BASE_URL;
const YOK_BASE_URL = "https://tez.yok.gov.tr";
const YOK_SEARCH_URL = `${YOK_BASE_URL}/UlusalTezMerkezi/SearchTez`;
const YOK_RECENT_URL = `${YOK_BASE_URL}/UlusalTezMerkezi/TezIslemleri?islem=7`;
const YOK_DETAIL_URL_TEMPLATE = `${YOK_BASE_URL}/UlusalTezMerkezi/tezDetay.jsp?id={thesisKey}&no={encryptedNo}`;
const YOK_DISCIPLINES_URL = `${YOK_BASE_URL}/UlusalTezMerkezi/abdEkle.jsp`;
const YOK_TOPICS_URL = `${YOK_BASE_URL}/UlusalTezMerkezi/konEkle.jsp`;

const buildCacheKey = (scope, value = "") => `${scope}:${value}`;

const getCached = (key) => {
  const hit = cache.get(key);

  if (!hit) {
    return null;
  }

  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }

  return hit.value;
};

const setCached = (key, value, ttlMs = CACHE_TTL_MS) => {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
};

const normalizeWhitespace = (value = "") => value.replace(/\s+/g, " ").trim();

const decodeYokText = (value = "") =>
  value
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\r/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\");

const splitSelectionLabel = (value = "") =>
  decodeYokText(value)
    .split("=")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

const dedupeThesesById = (items) => {
  const seen = new Set();

  return items.filter((item) => {
    const key = item.id || item.thesisNo || item.thesisKey;

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const normalizeKeyword = (value = "") => {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) {
    return "";
  }

  const [left, right] = cleaned.split("=").map((item) => normalizeWhitespace(item));
  if (!right) {
    return cleaned;
  }

  const leftHasTurkishChars = /[çğıöşüÇĞİÖŞÜ]/.test(left);
  return leftHasTurkishChars ? left : right;
};

const dedupeTitleParts = (value = "") => {
  const parts = value
    .split("/")
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);

  const unique = [];
  for (const part of parts) {
    if (!unique.some((existing) => existing.toLocaleLowerCase("tr") === part.toLocaleLowerCase("tr"))) {
      unique.push(part);
    }
  }

  return unique;
};

const splitUniversityInfo = (value = "") => {
  const [university, ...rest] = value.split(" / ").map((item) => item.trim()).filter(Boolean);
  return {
    university: university ?? "",
    department: rest.join(" / ")
  };
};

const buildDetailUrl = (thesisKey, encryptedNo) =>
  YOK_DETAIL_URL_TEMPLATE.replace("{thesisKey}", encodeURIComponent(thesisKey)).replace(
    "{encryptedNo}",
    encodeURIComponent(encryptedNo)
  );

const normalizeSearchText = (value = "") =>
  normalizeWhitespace(value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const GENERIC_CATEGORY_TERMS = new Set([
  "academic research",
  "thesis",
  "research",
  "education and training",
  "education",
  "history",
  "law",
  "religion",
  "medicine",
  "political science"
]);

const PRIORITY_CATEGORY_PATTERNS = [
  /edebiyat/i,
  /literature/i,
  /psychology/i,
  /psikoloji/i,
  /mimarl/i,
  /architecture/i,
  /bilgisayar/i,
  /computer/i,
  /hukuk/i,
  /law/i,
  /tip/i,
  /medicine/i
];

function buildSearchParams({ query = "", page = 1, resultsPerPage = 4, year = null }) {
  const form = new URLSearchParams();
  form.set("page", String(page));
  form.set("limit", String(resultsPerPage));
  form.set("tezDurumu", "3");
  form.set("izin", "1");
  form.set("yil1", String(year || "0"));
  form.set("yil2", String(year || "0"));
  form.set("Tur", "0");
  form.set("Dil", "0");
  form.set("EnstituGrubu", "");

  if (query.trim()) {
    form.set("TezAd", query.trim());
    form.set("Konu", query.trim());
    form.set("Metin", query.trim());
  }

  return form;
}

function buildDetailedSearchParams({
  disciplineName = "",
  disciplineCode = "0",
  instituteGroup = "",
  topic = "",
  thesisTitle = "",
  abstractText = "",
  authorName = "",
  year = null,
} = {}) {
  const form = new URLSearchParams();
  form.set("islem", "2");
  form.set("Universite", "0");
  form.set("Tur", "0");
  form.set("yil1", String(year || "0"));
  form.set("yil2", String(year || "0"));
  form.set("Enstitu", "0");
  form.set("izin", "1");
  form.set("TezNo", "");
  form.set("abdad", disciplineName);
  form.set("ABD", disciplineCode);
  form.set("Durum", "3");
  form.set("TezAd", thesisTitle);
  form.set("bilim", "");
  form.set("BilimDali", "0");
  form.set("Dil", "0");
  form.set("AdSoyad", authorName);
  form.set("Konu", topic);
  form.set("EnstituGrubu", instituteGroup);
  form.set("DanismanAdSoyad", "");
  form.set("Dizin", "");
  form.set("Metin", abstractText);
  form.set("Bolum", "0");
  return form;
}

async function fetchFromPlaywrightServer(path, params = {}) {
  if (!scraperBaseUrl) {
    return null;
  }

  const url = new URL(path, scraperBaseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Scraper request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function postYokSearch({ query = "", page = 1, resultsPerPage = 4, year = null }) {
  const response = await fetch(YOK_SEARCH_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    },
    body: buildSearchParams({ query, page, resultsPerPage, year })
  });

  if (!response.ok) {
    throw new Error(`YOK search failed: ${response.status} ${response.statusText}`);
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");

    if (!location) {
      throw new Error("YOK search redirect missing location header");
    }

    const redirectUrl = location.startsWith("http://")
      ? location.replace("http://", "https://")
      : new URL(location, YOK_BASE_URL).toString();
    const redirected = await fetch(redirectUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
      }
    });

    if (!redirected.ok) {
      throw new Error(`YOK redirected search failed: ${redirected.status} ${redirected.statusText}`);
    }

    return redirected.text();
  }

  return response.text();
}

async function postYokDetailedSearch({
  disciplineName = "",
  disciplineCode = "0",
  instituteGroup = "",
  topic = "",
  thesisTitle = "",
  abstractText = "",
  authorName = "",
  year = null,
} = {}) {
  const response = await fetch(YOK_SEARCH_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    },
    body: buildDetailedSearchParams({
      disciplineName,
      disciplineCode,
      instituteGroup,
      topic,
      thesisTitle,
      abstractText,
      authorName,
      year,
    }),
  });

  if (![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`YOK detailed search failed: ${response.status} ${response.statusText}`);
  }

  const location = response.headers.get("location");
  const sessionCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";

  if (!location) {
    throw new Error("YOK detailed search redirect missing location header");
  }

  const redirectUrl = location.startsWith("http://")
    ? location.replace("http://", "https://")
    : new URL(location, YOK_BASE_URL).toString();
  const redirected = await fetch(redirectUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      Referer: `${YOK_BASE_URL}/UlusalTezMerkezi/tarama.jsp`,
    },
  });

  if (!redirected.ok) {
    throw new Error(
      `YOK detailed search results failed: ${redirected.status} ${redirected.statusText}`,
    );
  }

  return redirected.text();
}

async function fetchRecentResultsPage() {
  const cacheKey = buildCacheKey("recent-page");
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const initial = await fetch(YOK_RECENT_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    },
    redirect: "manual"
  });

  const location = initial.headers.get("location");
  const sessionCookie = initial.headers.get("set-cookie")?.split(";")[0] ?? "";

  if (!location) {
    throw new Error("YOK recent theses redirect missing location header");
  }

  const redirected = await fetch(location.replace("http://", "https://"), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      Cookie: sessionCookie
    }
  });

  if (!redirected.ok) {
    throw new Error(`YOK recent theses failed: ${redirected.status} ${redirected.statusText}`);
  }

  return setCached(cacheKey, await redirected.text(), CACHE_TTL_MS);
}

function parseSearchResults(html) {
  const docs = Array.from(html.matchAll(/var doc = \{(.+?)\};/gs));

  return docs
    .map((match) => {
      const doc = match[1];
      const idMatch = doc.match(/onclick=tezDetay\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)>([^<]+)/);
      if (!idMatch) {
        return null;
      }

      const [, thesisKey, encryptedNo, thesisNoRaw] = idMatch;
      const author = doc.match(/name:\s*"([^"]*)"/)?.[1] ?? "";
      const year = doc.match(/age:\s*"([^"]*)"/)?.[1] ?? "";
      const universityInfo = doc.match(/uni:\s*"([^"]*)"/)?.[1] ?? "";
      const thesisType = doc.match(/important:\s*"([^"]*)"/)?.[1] ?? "";
      const subject = doc.match(/someDate:\s*"([^"]*)"/)?.[1] ?? "";
      const weightRaw = doc.match(/weight:\s*"((?:[^"\\]|\\.)*)"/s)?.[1] ?? "";
      const weightDecoded = weightRaw
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "")
        .replace(/\\t/g, "")
        .replace(/\\\\/g, "\\");
      const $ = load(weightDecoded);
      const htmlWithBreaks = $.html().replace(/<br\s*\/?>/gi, "\n");
      const textParts = load(`<div>${htmlWithBreaks}</div>`)("div")
        .text()
        .split("\n")
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean);
      const originalTitle = decodeYokText(textParts[0] ?? "");
      const translatedTitle = $("span").first().text()
        ? normalizeWhitespace(decodeYokText($("span").first().text()))
        : decodeYokText(textParts[1] ?? "");
      const titleParts = dedupeTitleParts(
        translatedTitle ? `${originalTitle} / ${translatedTitle}` : originalTitle
      );
      const title = titleParts[0] ?? originalTitle;

      return {
        thesisNo: normalizeWhitespace(decodeYokText(thesisNoRaw)),
        thesisKey,
        encryptedNo,
        title,
        titleVariants: titleParts,
        author: normalizeWhitespace(decodeYokText(author)),
        year: normalizeWhitespace(decodeYokText(year)),
        universityInfo: normalizeWhitespace(decodeYokText(universityInfo)),
        thesisType: normalizeWhitespace(decodeYokText(thesisType)),
        subject: normalizeWhitespace(decodeYokText(subject)),
        detailPageUrl: buildDetailUrl(thesisKey, encryptedNo)
      };
    })
    .filter(Boolean);
}

async function fetchYokDetail(detailPageUrl) {
  const cacheKey = buildCacheKey("detail-url", detailPageUrl);
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const response = await fetch(detailPageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`YOK detail failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = load(html);
  const mainTable = $('table[width="100%"][cellspacing="0"][cellpadding="1"]').first();
  const topCells = mainTable.find("tr").eq(1).find('td[valign="top"]');
  const statusLines = topCells
    .eq(3)
    .text()
    .split("\n")
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);

  const detail = {
    thesisNo: normalizeWhitespace(decodeYokText(topCells.eq(0).text())),
    author: normalizeWhitespace(
      decodeYokText(
        topCells
        .eq(2)
        .text()
        .split("Yazar:")
        .at(1)
        ?.split("Danışman:")[0] ?? ""
      )
    ),
    universityInfo: normalizeWhitespace(
      decodeYokText(
        topCells
        .eq(2)
        .text()
        .split("Yer Bilgisi:")
        .at(1)
        ?.split("Konu:")[0] ?? ""
      )
    ),
    subject: normalizeWhitespace(
      decodeYokText(
        topCells
        .eq(2)
        .text()
        .split("Konu:")
        .at(1)
        ?.split("Dizin:")[0] ?? ""
      )
    ),
    indexTerms: normalizeWhitespace(decodeYokText(topCells.eq(2).text().split("Dizin:").at(1) ?? "")),
    thesisType: decodeYokText(statusLines[1] ?? ""),
    language: decodeYokText(statusLines[2] ?? ""),
    year: decodeYokText(statusLines[3] ?? ""),
    abstractTr: normalizeWhitespace(decodeYokText($("#td0").text())),
    abstractEn: normalizeWhitespace(decodeYokText($("#td1").text()))
  };

  return setCached(cacheKey, detail, DETAIL_CACHE_TTL_MS);
}

function normalizeRealThesis(searchResult, detail = null) {
  const universitySplit = splitUniversityInfo(detail?.universityInfo || searchResult.universityInfo);
  const keywords = [
    ...(detail?.subject ? detail.subject.split(";") : searchResult.subject.split(";")),
    ...(detail?.indexTerms ? detail.indexTerms.split(";") : [])
  ]
    .map((item) => normalizeKeyword(item))
    .filter(Boolean)
    .slice(0, 6);

  return {
    id: searchResult.thesisNo || searchResult.thesisKey,
    thesisNo: searchResult.thesisNo,
    thesisKey: searchResult.thesisKey,
    encryptedNo: searchResult.encryptedNo,
    detailPageUrl: searchResult.detailPageUrl,
    title: detail?.title || searchResult.title,
    titleVariants: searchResult.titleVariants ?? [detail?.title || searchResult.title],
    author: detail?.author || searchResult.author,
    year: detail?.year || searchResult.year,
    university: universitySplit.university || "YOK Tez Merkezi",
    department: universitySplit.department || detail?.thesisType || searchResult.thesisType || "Academic Thesis",
    abstract: detail?.abstractTr || detail?.abstractEn || "Abstract not available.",
    keywords: keywords.length ? keywords : ["thesis", "academic research"],
    pdfUrl: searchResult.detailPageUrl,
    language:
      detail?.language?.toLocaleLowerCase("tr").includes("ingiliz")
        ? "en"
        : /[A-Za-z]{4,}/.test(detail?.abstractEn || "")
          ? "en"
          : "tr"
  };
}

async function searchRealTheses({ query = "", page = 1, resultsPerPage = 4, year = null }) {
  const html = await postYokSearch({ query, page, resultsPerPage, year });
  const compact = dedupeThesesById(parseSearchResults(html));
  const detailed = await Promise.all(
    compact.map(async (item) => {
      try {
        const detail = await fetchYokDetail(item.detailPageUrl);
        return normalizeRealThesis(item, detail);
      } catch {
        return normalizeRealThesis(item);
      }
    })
  );

  detailed.forEach((item) => {
    setCached(buildCacheKey("thesis", item.id), item, DETAIL_CACHE_TTL_MS);
  });

  return dedupeThesesById(detailed);
}

async function searchRealThesesDetailed({
  query = "",
  title = "",
  author = "",
  year = null,
  limit = 20,
} = {}) {
  const html = await postYokDetailedSearch({
    thesisTitle: normalizeWhitespace(title),
    topic: normalizeWhitespace(query),
    abstractText: normalizeWhitespace(query),
    authorName: normalizeWhitespace(author),
    year,
  });
  const compact = dedupeThesesById(parseSearchResults(html));
  const detailed = await Promise.all(
    compact.slice(0, Math.max(limit, 20)).map(async (item) => {
      try {
        const detail = await fetchYokDetail(item.detailPageUrl);
        return normalizeRealThesis(item, detail);
      } catch {
        return normalizeRealThesis(item);
      }
    })
  );

  detailed.forEach((item) => {
    setCached(buildCacheKey("thesis", item.id), item, DETAIL_CACHE_TTL_MS);
  });

  return dedupeThesesById(detailed);
}

async function getRecentRealTheses(offset = 0, limit = 4, year = null) {
  if (year && year !== "all") {
    const results = await searchRealTheses({ query: "", page: 1, resultsPerPage: offset + limit, year });
    const slice = results.slice(offset, offset + limit);
    return {
      items: slice,
      nextCursor: offset + slice.length
    };
  }

  const html = await fetchRecentResultsPage();
  const compact = dedupeThesesById(parseSearchResults(html));
  const slice = compact.slice(offset, offset + limit);
  const detailed = await Promise.all(
    slice.map(async (item) => {
      try {
        const detail = await fetchYokDetail(item.detailPageUrl);
        return normalizeRealThesis(item, detail);
      } catch {
        return normalizeRealThesis(item);
      }
    })
  );

  detailed.forEach((item) => {
    setCached(buildCacheKey("thesis", item.id), item, DETAIL_CACHE_TTL_MS);
  });

  const uniqueItems = dedupeThesesById(detailed);

  return {
    items: uniqueItems,
    nextCursor: offset + uniqueItems.length
  };
}

async function getRecentRealThesisPool(limit = 60) {
  const cacheKey = buildCacheKey("recent-pool", String(limit));
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const page = await getRecentRealTheses(0, limit);
  return setCached(cacheKey, page.items, CACHE_TTL_MS);
}

function filterThesesByQuery(items, query) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return items
    .map((item) => {
      const title = normalizeSearchText(item.title);
      const department = normalizeSearchText(item.department);
      const keywords = normalizeSearchText(item.keywords.join(" "));
      const university = normalizeSearchText(item.university);
      const abstract = normalizeSearchText(item.abstract);

      const score = tokens.reduce((total, token) => {
        const tokenStem = token.length > 5 ? token.slice(0, token.length - 2) : token;
        let next = total;

        if (department.includes(token) || department.includes(tokenStem)) {
          next += 6;
        }
        if (keywords.includes(token) || keywords.includes(tokenStem)) {
          next += 5;
        }
        if (title.includes(token) || title.includes(tokenStem)) {
          next += 4;
        }
        if (university.includes(token) || university.includes(tokenStem)) {
          next += 2;
        }
        if (abstract.includes(token) || abstract.includes(tokenStem)) {
          next += 1;
        }

        return next;
      }, 0);

      return { item, score };
    })
    .filter(({ score }) => score >= Math.max(4, tokens.length * 3))
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);
}

function filterThesesByDetailedCriteria(items, {
  query = "",
  title = "",
  author = "",
  source = "",
  year = "",
} = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(title);
  const normalizedAuthor = normalizeSearchText(author);
  const normalizedSource = normalizeSearchText(source);
  const normalizedYear = normalizeWhitespace(year);

  return items.filter((item) => {
    const titleText = normalizeSearchText(item.title);
    const authorText = normalizeSearchText(item.author);
    const universityText = normalizeSearchText(item.university);
    const departmentText = normalizeSearchText(item.department);
    const abstractText = normalizeSearchText(item.abstract);
    const keywordsText = normalizeSearchText((item.keywords ?? []).join(" "));

    if (normalizedTitle && !titleText.includes(normalizedTitle)) {
      return false;
    }

    if (normalizedAuthor && !authorText.includes(normalizedAuthor)) {
      return false;
    }

    if (
      normalizedSource &&
      !universityText.includes(normalizedSource) &&
      !departmentText.includes(normalizedSource)
    ) {
      return false;
    }

    if (normalizedYear && String(item.year ?? "") !== normalizedYear) {
      return false;
    }

    if (
      normalizedQuery &&
      ![
        titleText,
        authorText,
        universityText,
        departmentText,
        abstractText,
        keywordsText,
      ].some((value) => value.includes(normalizedQuery))
    ) {
      return false;
    }

    return true;
  });
}

function extractLiveCategories(items) {
  const counts = new Map();

  for (const item of items) {
    const candidates = [...(item.keywords ?? [])];

    for (const candidate of candidates) {
      const label = normalizeWhitespace(candidate);
      const normalized = normalizeSearchText(label);

      if (
        !label ||
        normalized.length < 4 ||
        GENERIC_CATEGORY_TERMS.has(normalized) ||
        normalized.includes("enstitu") ||
        normalized.includes("hastane") ||
        normalized.includes("anabilim dali") ||
        normalized.includes("bilim dali")
      ) {
        continue;
      }

      const current = counts.get(normalized) ?? { id: normalized, label, query: label, count: 0 };
      current.count += 1;
      if (label.length < current.label.length) {
        current.label = label;
        current.query = label;
      }
      counts.set(normalized, current);
    }
  }

  return Array.from(counts.values())
    .filter(
      (item) =>
        item.count >= 2 ||
        PRIORITY_CATEGORY_PATTERNS.some((pattern) => pattern.test(item.label))
    )
    .sort((left, right) => {
      const leftPriority = PRIORITY_CATEGORY_PATTERNS.some((pattern) => pattern.test(left.label));
      const rightPriority = PRIORITY_CATEGORY_PATTERNS.some((pattern) => pattern.test(right.label));

      if (leftPriority !== rightPriority) {
        return leftPriority ? -1 : 1;
      }

      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label, "tr");
    })
    .slice(0, 40);
}

function filterThesesByCategory(items, category) {
  const normalizedCategory = normalizeSearchText(category);

  return items.filter((item) => {
    const haystack = normalizeSearchText(
      [
        item.department,
        item.keywords.join(" "),
        item.title
      ].join(" ")
    );

    return haystack.includes(normalizedCategory);
  });
}

function parseSelectionOptions(html) {
  return Array.from(
    html.matchAll(/eklecikar\('((?:\\'|[^'])*)','([^']*)','([^']*)'\)/g),
  )
    .map((match) => {
      const label = normalizeWhitespace(decodeYokText(match[1]));
      const parts = splitSelectionLabel(label);
      const aliases = Array.from(
        new Set(
          parts
            .map((part) => normalizeSearchText(part))
            .filter(Boolean),
        ),
      );

      return {
        id: normalizeSearchText(label),
        label,
        query: parts[0] ?? label,
        aliases,
        code: match[2],
        row: match[3],
      };
    })
    .filter((item) => item.label && item.aliases.length > 0);
}

async function fetchSelectionPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`YOK selection page failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function filterThesesBySelection(items, selection) {
  const aliases = selection.aliases ?? [normalizeSearchText(selection.query ?? selection.label ?? "")];

  return items.filter((item) => {
    const haystack = normalizeSearchText(
      [
        item.department,
        item.keywords.join(" "),
        item.title,
        item.university,
      ].join(" "),
    );

    return aliases.some((alias) => alias && haystack.includes(alias));
  });
}

function rankSelectionsByAvailability(selections, items) {
  return selections
    .map((selection) => {
      const count = filterThesesBySelection(items, selection).length;
      return { ...selection, count };
    })
    .filter((selection) => selection.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label, "tr");
    });
}

const normalizeSample = (thesis) => ({
  id: thesis.id,
  title: thesis.title,
  author: thesis.author,
  year: thesis.year,
  university: thesis.university,
  department: thesis.department,
  abstract: thesis.abstract,
  keywords: thesis.keywords,
  pdfUrl: thesis.pdfUrl,
  language: thesis.language
});

export async function getRandomThesis(seed = Math.random()) {
  const cacheKey = buildCacheKey("random", String(seed).slice(0, 5));
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const remote = await fetchFromPlaywrightServer("/random-thesis");

  if (remote) {
    return setCached(cacheKey, remote);
  }

  try {
    const offset = Math.floor(seed * 100);
    const { items } = await getRecentRealTheses(offset, 1);
    if (items[0]) {
      return setCached(cacheKey, items[0]);
    }
  } catch {
  }

  const index = Math.floor(seed * sampleTheses.length) % sampleTheses.length;
  return setCached(cacheKey, normalizeSample(sampleTheses[index]));
}

export async function getFeed(cursor = 0, limit = 4, year = null) {
  const cacheKey = buildCacheKey("feed", `${cursor}:${limit}:${year || "all"}`);
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const payload = await getRecentRealTheses(cursor, limit, year);
    return setCached(cacheKey, payload);
  } catch {
    const results = Array.from({ length: limit }, (_, offset) => {
      const thesis = sampleTheses[(cursor + offset) % sampleTheses.length];
      return normalizeSample(thesis);
    });

    return setCached(cacheKey, {
      items: results,
      nextCursor: cursor + results.length
    });
  }
}

export async function searchTheses(input = "") {
  const criteria =
    typeof input === "string"
      ? {
          query: input,
          title: "",
          author: "",
          source: "",
          year: "",
          limit: 24,
        }
      : {
          query: String(input?.query ?? ""),
          title: String(input?.title ?? ""),
          author: String(input?.author ?? ""),
          source: String(input?.source ?? ""),
          year: String(input?.year ?? ""),
          limit: Math.min(Math.max(Number(input?.limit ?? 24), 1), 40),
        };
  const normalizedQuery = JSON.stringify({
    query: normalizeWhitespace(criteria.query).toLocaleLowerCase("tr"),
    title: normalizeWhitespace(criteria.title).toLocaleLowerCase("tr"),
    author: normalizeWhitespace(criteria.author).toLocaleLowerCase("tr"),
    source: normalizeWhitespace(criteria.source).toLocaleLowerCase("tr"),
    year: normalizeWhitespace(criteria.year),
    limit: criteria.limit,
  });
  const cacheKey = buildCacheKey("search", normalizedQuery);
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const remote = await fetchFromPlaywrightServer("/search", {
    q: criteria.query,
    title: criteria.title,
    author: criteria.author,
    source: criteria.source,
    year: criteria.year,
    limit: criteria.limit,
  });

  if (remote?.items?.length) {
    return setCached(cacheKey, remote.items);
  }

  const hasSearchCriteria = [
    criteria.query,
    criteria.title,
    criteria.author,
    criteria.source,
    criteria.year,
  ].some((value) => normalizeWhitespace(value));

  if (!hasSearchCriteria) {
    return [];
  }

  try {
    const results =
      normalizeWhitespace(criteria.title) ||
      normalizeWhitespace(criteria.author) ||
      normalizeWhitespace(criteria.source)
        ? await searchRealThesesDetailed({
            query: criteria.query,
            title: criteria.title,
            author: criteria.author,
            year: criteria.year || null,
            limit: criteria.limit,
          })
        : await searchRealTheses({
            query: criteria.query,
            page: 1,
            resultsPerPage: Math.min(Math.max(criteria.limit, 8), 24),
            year: criteria.year || null,
          });
    const filteredResults = filterThesesByDetailedCriteria(results, criteria).slice(0, criteria.limit);
    if (filteredResults.length > 0) {
      return setCached(cacheKey, filteredResults);
    }
  } catch {
  }

  try {
    const recentPool = await getRecentRealThesisPool(80);
    const baseResults = normalizeWhitespace(criteria.query)
      ? filterThesesByQuery(recentPool, criteria.query)
      : recentPool;
    const fallbackResults = filterThesesByDetailedCriteria(baseResults, criteria).slice(0, criteria.limit);

    if (fallbackResults.length > 0) {
      return setCached(cacheKey, fallbackResults);
    }
  } catch {
  }

  const results = sampleTheses.filter((thesis) => {
    const haystack = [
      thesis.title,
      thesis.author,
      thesis.department,
      thesis.university,
      thesis.abstract,
      thesis.keywords.join(" ")
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(normalizeWhitespace(criteria.query).toLocaleLowerCase("tr"));
  });

  return setCached(
    cacheKey,
    filterThesesByDetailedCriteria(results.map(normalizeSample), criteria).slice(0, criteria.limit),
  );
}

export async function getCategories() {
  const cacheKey = buildCacheKey("categories", "live");
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const recentPool = await getRecentRealThesisPool(120);
    return setCached(cacheKey, extractLiveCategories(recentPool), CACHE_TTL_MS);
  } catch {
    const sampleCategories = extractLiveCategories(sampleTheses.map(normalizeSample));
    return setCached(cacheKey, sampleCategories, CACHE_TTL_MS);
  }
}

export async function getDisciplines() {
  const cacheKey = buildCacheKey("disciplines", "local-all");
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const items = [...abdDisciplines].sort((left, right) =>
    left.label.localeCompare(right.label, "tr"),
  );
  return setCached(cacheKey, items, CACHE_TTL_MS);
}

async function getAllDisciplines() {
  return abdDisciplines;
}

export async function getTopics() {
  const cacheKey = buildCacheKey("topics", "live");
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const html = await fetchSelectionPage(YOK_TOPICS_URL);
  return setCached(cacheKey, parseSelectionOptions(html), CACHE_TTL_MS);
}

export async function getDisciplineFeed(disciplineId = "", year = null) {
  const normalizedId = normalizeWhitespace(disciplineId);
  const cacheKey = buildCacheKey("discipline-feed", `${normalizedId}:${year || "all"}`);
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  if (!normalizedId) {
    return { items: [], count: 0 };
  }

  const disciplines = await getAllDisciplines();
  const match = disciplines.find((item) => item.id === normalizeSearchText(normalizedId) || item.id === normalizedId);

  if (!match) {
    return { items: [], count: 0 };
  }

  try {
    const html = await postYokDetailedSearch({
      disciplineName: match.label,
      disciplineCode: match.code ?? "0",
      instituteGroup: "",
      year: year,
    });
    const compact = dedupeThesesById(parseSearchResults(html));
    const detailed = await Promise.all(
      compact.slice(0, 40).map(async (item) => {
        try {
          const detail = await fetchYokDetail(item.detailPageUrl);
          return normalizeRealThesis(item, detail);
        } catch {
          return normalizeRealThesis(item);
        }
      }),
    );
    const items = dedupeThesesById(detailed).slice(0, 40);

    if (items.length > 0) {
      return setCached(cacheKey, { items, count: items.length, discipline: match }, CACHE_TTL_MS);
    }
  } catch {
  }

  try {
    const recentPool = await getRecentRealThesisPool(300);
    const items = dedupeThesesById(filterThesesBySelection(recentPool, match)).slice(0, 40);

    if (items.length > 0) {
      return setCached(cacheKey, { items, count: items.length, discipline: match }, CACHE_TTL_MS);
    }
  } catch {
  }

  const items = sampleTheses
    .map(normalizeSample)
    .filter((item) => filterThesesBySelection([item], match).length > 0);
  return setCached(cacheKey, { items, count: items.length, discipline: match }, CACHE_TTL_MS);
}

export async function getCategoryFeed(category = "") {
  const normalizedCategory = normalizeWhitespace(category);
  const cacheKey = buildCacheKey("category-feed", normalizedCategory);
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  if (!normalizedCategory) {
    return { items: [], count: 0 };
  }

  try {
    const recentPool = await getRecentRealThesisPool(120);
    const items = dedupeThesesById(filterThesesByCategory(recentPool, normalizedCategory)).slice(0, 24);
    return setCached(cacheKey, { items, count: items.length }, CACHE_TTL_MS);
  } catch {
    const items = sampleTheses
      .map(normalizeSample)
      .filter((item) => filterThesesByCategory([item], normalizedCategory).length > 0);
    return setCached(cacheKey, { items, count: items.length }, CACHE_TTL_MS);
  }
}

export async function getThesisById(id) {
  const cacheKey = buildCacheKey("thesis", id);
  const cached = getCached(cacheKey);

  if (cached) {
    return cached;
  }

  const remote = await fetchFromPlaywrightServer(`/thesis/${id}`);

  if (remote) {
    return setCached(cacheKey, remote);
  }

  try {
    const results = await searchRealTheses({ query: id, page: 1, resultsPerPage: 8 });
    const match = results.find((item) => item.id === id || item.thesisNo === id);
    if (match) {
      return setCached(cacheKey, match, DETAIL_CACHE_TTL_MS);
    }
  } catch {
  }

  const thesis = sampleTheses.find((item) => item.id === id);
  return thesis ? setCached(cacheKey, normalizeSample(thesis)) : null;
}

export function getCacheStats() {
  return {
    entries: cache.size,
    ttlMs: CACHE_TTL_MS
  };
}
