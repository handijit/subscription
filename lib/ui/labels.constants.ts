import type {
  PlanInterval,
  SubscriptionStatus,
  UnavailableReason,
} from "../types";

/** Every text the components show. Turkish by default; pass `labels` to change any of them. */
type SubscriptionLabels = {
  /** The gate while the license is being read. */
  checking: string;
  /** The gate's heading once the trial is over. */
  trialExpiredTitle: string;
  /** The explanation once the trial is over. */
  trialExpiredBody: (productName: string) => string;
  /** The gate's heading when no trial applies and no subscription is live. */
  requiredTitle: string;
  /** The explanation to a signed-in customer without a live subscription. */
  requiredBodySignedIn: (productName: string) => string;
  /** The explanation to a signed-out user when the program has no trial. */
  requiredBodySignedOut: (productName: string) => string;
  /** The gate's heading when the subscription is bound to another installation. */
  mismatchTitle: string;
  /** The explanation of a device mismatch; `device` is the other machine's name, if known. */
  mismatchBody: (device: string | null) => string;
  /** The button that opens the panel to free the device. */
  releaseDevice: string;
  /** The gate's heading when no decision can be reached. */
  unavailableTitle: (reason: UnavailableReason) => string;
  /** The explanation when no decision can be reached. */
  unavailableBody: (reason: UnavailableReason) => string;
  /** The name of a plan. */
  planName: (interval: PlanInterval) => string;
  /** What a price is for: "/ ay". */
  perPeriod: (interval: PlanInterval) => string;
  /** The button that buys a plan. */
  buy: (interval: PlanInterval) => string;
  /** The note on the yearly plan: how much cheaper it is than twelve months. */
  saving: (percent: number) => string;
  /** A plan that cannot be bought right now. */
  notForSale: string;
  /** Under the plans: prices include VAT, payment on the web site. */
  priceNote: string;
  /** While the prices are read. */
  plansLoading: string;
  /** The prices could not be read. */
  plansFailed: string;
  /** The program has no plans on sale. */
  noPlans: string;
  /** The question before the sign-in button. */
  haveSubscription: string;
  /** The sign-in button. */
  signIn: string;
  /** The heading of the note while the purchase is pending. */
  purchasePendingTitle: string;
  /** The note while the purchase is pending and the customer is signed in. */
  purchasePendingBody: string;
  /** The note while the purchase is pending and nobody is signed in. */
  purchasePendingSignIn: string;
  /** Opens the subscription page again. */
  reopenPage: string;
  /** Stops waiting for the purchase. */
  cancel: string;
  /** Asks for the license again. */
  retry: string;
  /** Opens the subscription page. */
  manage: string;
  /** The banner during the trial; `days` is the whole days left (0 on the last day). */
  trialLeft: (days: number) => string;
  /** The banner's buy button. */
  subscribe: string;
  /** The status: the name of each status for the settings page. */
  statusName: (status: SubscriptionStatus, plan: PlanInterval | null) => string;
  /** The status: when the trial ends. */
  trialEndsOn: (date: string) => string;
  /** The status: until when the held license works without the backend. */
  validUntil: (date: string) => string;
  /** The status: the last answer of the backend. */
  checkedOn: (date: string) => string;
  /** The status: shown while the last request did not reach the backend. */
  offline: string;
  /** The status: the button that renews the license. */
  refresh: string;
};

const PLAN_NAMES: Readonly<Record<PlanInterval, string>> = {
  monthly: "Aylık",
  yearly: "Yıllık",
};

const UNAVAILABLE_TITLES: Readonly<Record<UnavailableReason, string>> = {
  offline: "İnternet bağlantısı gerekli",
  service: "Lisans sunucusuna ulaşılamıyor",
  clock: "Bilgisayarın saati yanlış",
  "update-required": "Programın yeni sürümü gerekli",
  "license-invalid": "Lisans doğrulanamadı",
  "unsupported-platform": "Bu işletim sistemi desteklenmiyor",
};

const UNAVAILABLE_BODIES: Readonly<Record<UnavailableReason, string>> = {
  offline:
    "Lisansı doğrulamak için programın bir kez internete bağlanması gerekiyor. Bağlantı gelince kendiliğinden yeniden denenecek.",
  service:
    "Lisans sunucusu şu anda yanıt vermiyor. Birkaç dakika içinde kendiliğinden yeniden denenecek.",
  clock:
    "Bilgisayarın tarihi ya da saati geri alınmış görünüyor. Tarih ve saati otomatik ayara getirip yeniden deneyin.",
  "update-required":
    "Bu sürüm yeni lisansları doğrulayamıyor. Programı güncelleyip yeniden açın.",
  "license-invalid":
    "Sunucudan gelen lisans bu kurulum için geçerli değil. Yeniden deneyin; sorun sürerse destekle iletişime geçin.",
  "unsupported-platform":
    "Bu program yalnızca Windows ve macOS üzerinde, x64 ya da arm64 işlemcilerde çalışır.",
};

const STATUS_NAMES: Readonly<Record<SubscriptionStatus, string>> = {
  loading: "Denetleniyor",
  trial: "Deneme sürümü",
  subscribed: "Abonelik",
  "trial-expired": "Deneme süresi doldu",
  "subscription-required": "Abonelik yok",
  "device-mismatch": "Başka cihaza bağlı",
  unavailable: "Doğrulanamadı",
};

const DEFAULT_SUBSCRIPTION_LABELS: Readonly<SubscriptionLabels> = {
  checking: "Lisans denetleniyor…",
  trialExpiredTitle: "Deneme süreniz doldu",
  trialExpiredBody: (productName) =>
    `${productName} programını kullanmaya devam etmek için bir abonelik seçin. Verileriniz bu bilgisayarda yerinde duruyor.`,
  requiredTitle: "Abonelik gerekli",
  requiredBodySignedIn: (productName) =>
    `Hesabınızda ${productName} için etkin bir abonelik yok. Bir abonelik başlattığınızda program kendiliğinden açılır.`,
  requiredBodySignedOut: (productName) =>
    `${productName} abonelikle kullanılır. Bir plan seçin ya da aboneliğiniz varsa giriş yapın.`,
  mismatchTitle: "Abonelik başka bir cihaza bağlı",
  mismatchBody: (device) =>
    `${device === null ? "Aboneliğiniz başka bir bilgisayara" : `Aboneliğiniz ${device} cihazına`} bağlı. Bu bilgisayarda kullanmak için web panelinden cihazı serbest bırakın; 30 günde en çok 2 kez değiştirilebilir.`,
  releaseDevice: "Panelde cihazı değiştir",
  unavailableTitle: (reason) => UNAVAILABLE_TITLES[reason],
  unavailableBody: (reason) => UNAVAILABLE_BODIES[reason],
  planName: (interval) => PLAN_NAMES[interval],
  perPeriod: (interval) => (interval === "monthly" ? "/ ay" : "/ yıl"),
  buy: (interval) => `${PLAN_NAMES[interval]} abone ol`,
  saving: (percent) => `%${percent} daha uygun`,
  notForSale: "Şu anda satın alınamıyor",
  priceNote:
    "Fiyatlara KDV dahildir. Ödeme handijit.com üzerinde, tarayıcınızda yapılır.",
  plansLoading: "Fiyatlar yükleniyor…",
  plansFailed: "Fiyatlar alınamadı.",
  noPlans: "Bu program şu anda satışta değil.",
  haveSubscription: "Aboneliğiniz var mı?",
  signIn: "Giriş yap",
  purchasePendingTitle: "Ödeme bekleniyor",
  purchasePendingBody:
    "Ödeme sayfası tarayıcınızda açıldı. Ödeme tamamlanınca program kendiliğinden açılacak.",
  purchasePendingSignIn:
    "Ödeme sayfası tarayıcınızda açıldı. Ödemeden sonra bu programda da aynı hesapla giriş yapın.",
  reopenPage: "Sayfayı yeniden aç",
  cancel: "Vazgeç",
  retry: "Yeniden dene",
  manage: "Aboneliği yönet",
  trialLeft: (days) =>
    days <= 0
      ? "Deneme süreniz bugün bitiyor."
      : `Deneme sürümü: ${days} gün kaldı.`,
  subscribe: "Abone ol",
  statusName: (status, plan) =>
    status === "subscribed" && plan !== null
      ? `${PLAN_NAMES[plan]} abonelik`
      : STATUS_NAMES[status],
  trialEndsOn: (date) => `Deneme ${date} tarihinde bitiyor`,
  validUntil: (date) => `Lisans ${date} tarihine kadar çevrimdışı geçerli`,
  checkedOn: (date) => `Son denetim ${date}`,
  offline: "Çevrimdışı",
  refresh: "Lisansı yenile",
};

export type { SubscriptionLabels };
export default DEFAULT_SUBSCRIPTION_LABELS;
