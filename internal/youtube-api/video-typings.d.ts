export interface RefinedVideoMetadata extends Record<string, string> {
  videoId: string;
  author: string;
  title: string;
  thumbnailUrl: string;
}

export interface VideoMetadata {
  responseContext: ResponseContext;
  playabilityStatus: PlayabilityStatus;
  streamingData: StreamingData;
  playerAds: PlayerAd[];
  playbackTracking: PlaybackTracking;
  videoDetails: VideoDetails;
  playerConfig: PlayerConfig;
  storyboards: Storyboards;
  microformat: Microformat;
  cards: Cards;
  trackingParams: string;
  messages: Message2[];
  adPlacements: AdPlacement[];
  adBreakHeartbeatParams: string;
  frameworkUpdates: FrameworkUpdates;
}

interface ResponseContext {
  serviceTrackingParams: ServiceTrackingParam[];
  maxAgeSeconds: number;
  mainAppWebResponseContext: MainAppWebResponseContext;
  webResponseContextExtensionData: WebResponseContextExtensionData;
}

interface ServiceTrackingParam {
  service: string;
  params: Param[];
}

interface Param {
  key: string;
  value: string;
}

interface MainAppWebResponseContext {
  datasyncId: string;
  loggedOut: boolean;
  trackingParam: string;
}

interface WebResponseContextExtensionData {
  hasDecorated: boolean;
}

interface PlayabilityStatus {
  status: string;
  playableInEmbed: boolean;
  miniplayer: Miniplayer;
  contextParams: string;
}

interface Miniplayer {
  miniplayerRenderer: MiniplayerRenderer;
}

interface MiniplayerRenderer {
  playbackMode: string;
  enableStashedPlayback: boolean;
}

interface StreamingData {
  expiresInSeconds: string;
  formats: Format[];
  adaptiveFormats: AdaptiveFormat[];
  serverAbrStreamingUrl: string;
}

interface Format {
  itag: number;
  mimeType: string;
  bitrate: number;
  width: number;
  height: number;
  lastModified: string;
  quality: string;
  fps: number;
  qualityLabel: string;
  projectionType: string;
  audioQuality: string;
  approxDurationMs: string;
  audioSampleRate: string;
  audioChannels: number;
  signatureCipher: string;
  qualityOrdinal: string;
}

interface AdaptiveFormat {
  itag: number;
  mimeType: string;
  bitrate: number;
  width?: number;
  height?: number;
  initRange: InitRange;
  indexRange: IndexRange;
  lastModified: string;
  contentLength: string;
  quality: string;
  fps?: number;
  qualityLabel?: string;
  projectionType: string;
  averageBitrate: number;
  approxDurationMs: string;
  qualityOrdinal: string;
  colorInfo?: ColorInfo;
  highReplication?: boolean;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  loudnessDb?: number;
}

interface InitRange {
  start: string;
  end: string;
}

interface IndexRange {
  start: string;
  end: string;
}

interface ColorInfo {
  primaries: string;
  transferCharacteristics: string;
  matrixCoefficients: string;
}

interface PlayerAd {
  playerLegacyDesktopWatchAdsRenderer: PlayerLegacyDesktopWatchAdsRenderer;
}

interface PlayerLegacyDesktopWatchAdsRenderer {
  playerAdParams: PlayerAdParams;
  gutParams: GutParams;
  showCompanion: boolean;
  showInstream: boolean;
  useGut: boolean;
}

interface PlayerAdParams {
  showContentThumbnail: boolean;
  enabledEngageTypes: string;
}

interface GutParams {
  tag: string;
}

interface PlaybackTracking {
  videostatsPlaybackUrl: VideostatsPlaybackUrl;
  videostatsDelayplayUrl: VideostatsDelayplayUrl;
  videostatsWatchtimeUrl: VideostatsWatchtimeUrl;
  ptrackingUrl: PtrackingUrl;
  qoeUrl: QoeUrl;
  atrUrl: AtrUrl;
  videostatsScheduledFlushWalltimeSeconds: number[];
  videostatsDefaultFlushIntervalSeconds: number;
}

interface VideostatsPlaybackUrl {
  baseUrl: string;
}

interface VideostatsDelayplayUrl {
  baseUrl: string;
}

interface VideostatsWatchtimeUrl {
  baseUrl: string;
}

interface PtrackingUrl {
  baseUrl: string;
}

interface QoeUrl {
  baseUrl: string;
}

interface AtrUrl {
  baseUrl: string;
  elapsedMediaTimeSeconds: number;
}

interface VideoDetails {
  videoId: string;
  title: string;
  lengthSeconds: string;
  keywords: string[];
  channelId: string;
  isOwnerViewing: boolean;
  shortDescription: string;
  isCrawlable: boolean;
  thumbnail: Thumbnail;
  allowRatings: boolean;
  viewCount: string;
  author: string;
  isPrivate: boolean;
  isUnpluggedCorpus: boolean;
  isLiveContent: boolean;
}

interface Thumbnail {
  thumbnails: Thumbnail2[];
}

interface Thumbnail2 {
  url: string;
  width: number;
  height: number;
}

interface PlayerConfig {
  audioConfig: AudioConfig;
  streamSelectionConfig: StreamSelectionConfig;
  mediaCommonConfig: MediaCommonConfig;
  webPlayerConfig: WebPlayerConfig;
}

interface AudioConfig {
  loudnessDb: number;
  perceptualLoudnessDb: number;
  enablePerFormatLoudness: boolean;
}

interface StreamSelectionConfig {
  maxBitrate: string;
}

interface MediaCommonConfig {
  dynamicReadaheadConfig: DynamicReadaheadConfig;
  mediaUstreamerRequestConfig: MediaUstreamerRequestConfig;
  useServerDrivenAbr: boolean;
  serverPlaybackStartConfig: ServerPlaybackStartConfig;
  fixLivePlaybackModelDefaultPosition: boolean;
}

interface DynamicReadaheadConfig {
  maxReadAheadMediaTimeMs: number;
  minReadAheadMediaTimeMs: number;
  readAheadGrowthRateMs: number;
}

interface MediaUstreamerRequestConfig {
  videoPlaybackUstreamerConfig: string;
}

interface ServerPlaybackStartConfig {
  enable: boolean;
  playbackStartPolicy: PlaybackStartPolicy;
}

interface PlaybackStartPolicy {
  startMinReadaheadPolicy: StartMinReadaheadPolicy[];
}

interface StartMinReadaheadPolicy {
  minReadaheadMs: number;
}

interface WebPlayerConfig {
  useCobaltTvosDash: boolean;
  webPlayerActionsPorting: WebPlayerActionsPorting;
}

interface WebPlayerActionsPorting {
  getSharePanelCommand: GetSharePanelCommand;
  subscribeCommand: SubscribeCommand;
  unsubscribeCommand: UnsubscribeCommand;
  addToWatchLaterCommand: AddToWatchLaterCommand;
  removeFromWatchLaterCommand: RemoveFromWatchLaterCommand;
}

interface GetSharePanelCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata;
  webPlayerShareEntityServiceEndpoint: WebPlayerShareEntityServiceEndpoint;
}

interface CommandMetadata {
  webCommandMetadata: WebCommandMetadata;
}

interface WebCommandMetadata {
  sendPost: boolean;
  apiUrl: string;
}

interface WebPlayerShareEntityServiceEndpoint {
  serializedShareEntity: string;
}

interface SubscribeCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata2;
  subscribeEndpoint: SubscribeEndpoint;
}

interface CommandMetadata2 {
  webCommandMetadata: WebCommandMetadata2;
}

interface WebCommandMetadata2 {
  sendPost: boolean;
  apiUrl: string;
}

interface SubscribeEndpoint {
  channelIds: string[];
  params: string;
}

interface UnsubscribeCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata3;
  unsubscribeEndpoint: UnsubscribeEndpoint;
}

interface CommandMetadata3 {
  webCommandMetadata: WebCommandMetadata3;
}

interface WebCommandMetadata3 {
  sendPost: boolean;
  apiUrl: string;
}

interface UnsubscribeEndpoint {
  channelIds: string[];
  params: string;
}

interface AddToWatchLaterCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata4;
  playlistEditEndpoint: PlaylistEditEndpoint;
}

interface CommandMetadata4 {
  webCommandMetadata: WebCommandMetadata4;
}

interface WebCommandMetadata4 {
  sendPost: boolean;
  apiUrl: string;
}

interface PlaylistEditEndpoint {
  playlistId: string;
  actions: Action[];
}

interface Action {
  addedVideoId: string;
  action: string;
}

interface RemoveFromWatchLaterCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata5;
  playlistEditEndpoint: PlaylistEditEndpoint2;
}

interface CommandMetadata5 {
  webCommandMetadata: WebCommandMetadata5;
}

interface WebCommandMetadata5 {
  sendPost: boolean;
  apiUrl: string;
}

interface PlaylistEditEndpoint2 {
  playlistId: string;
  actions: Action2[];
}

interface Action2 {
  action: string;
  removedVideoId: string;
}

interface Storyboards {
  playerStoryboardSpecRenderer: PlayerStoryboardSpecRenderer;
}

interface PlayerStoryboardSpecRenderer {
  spec: string;
  recommendedLevel: number;
  highResolutionRecommendedLevel: number;
}

interface Microformat {
  playerMicroformatRenderer: PlayerMicroformatRenderer;
}

interface PlayerMicroformatRenderer {
  thumbnail: Thumbnail3;
  embed: Embed;
  title: Title;
  description?: Description;
  lengthSeconds: string;
  ownerProfileUrl: string;
  externalChannelId: string;
  isFamilySafe: boolean;
  availableCountries: string[];
  isUnlisted: boolean;
  hasYpcMetadata: boolean;
  viewCount: string;
  category: string;
  publishDate: string;
  ownerChannelName: string;
  uploadDate: string;
  isShortsEligible: boolean;
  externalVideoId: string;
  likeCount: string;
  canonicalUrl: string;
}

interface Thumbnail3 {
  thumbnails: Thumbnail4[];
}

interface Thumbnail4 {
  url: string;
  width: number;
  height: number;
}

interface Embed {
  iframeUrl: string;
  width: number;
  height: number;
}

interface Title {
  simpleText: string;
}

interface Description {
  simpleText: string;
}

interface Cards {
  cardCollectionRenderer: CardCollectionRenderer;
}

interface CardCollectionRenderer {
  cards: Card[];
  headerText: HeaderText;
  icon: Icon;
  closeButton: CloseButton;
  trackingParams: string;
  allowTeaserDismiss: boolean;
  logIconVisibilityUpdates: boolean;
}

interface Card {
  cardRenderer: CardRenderer;
}

interface CardRenderer {
  teaser: Teaser;
  cueRanges: CueRange[];
  trackingParams: string;
}

interface Teaser {
  simpleCardTeaserRenderer: SimpleCardTeaserRenderer;
}

interface SimpleCardTeaserRenderer {
  message: Message;
  trackingParams: string;
  prominent: boolean;
  logVisibilityUpdates: boolean;
  onTapCommand: OnTapCommand;
}

interface Message {
  simpleText: string;
}

interface OnTapCommand {
  clickTrackingParams: string;
  changeEngagementPanelVisibilityAction: ChangeEngagementPanelVisibilityAction;
}

interface ChangeEngagementPanelVisibilityAction {
  targetId: string;
  visibility: string;
}

interface CueRange {
  startCardActiveMs: string;
  endCardActiveMs: string;
  teaserDurationMs: string;
  iconAfterTeaserMs: string;
}

interface HeaderText {
  simpleText: string;
}

interface Icon {
  infoCardIconRenderer: InfoCardIconRenderer;
}

interface InfoCardIconRenderer {
  trackingParams: string;
}

interface CloseButton {
  infoCardIconRenderer: InfoCardIconRenderer2;
}

interface InfoCardIconRenderer2 {
  trackingParams: string;
}

interface Message2 {
  mealbarPromoRenderer: MealbarPromoRenderer;
}

interface MealbarPromoRenderer {
  messageTexts: MessageText[];
  actionButton: ActionButton;
  dismissButton: DismissButton;
  triggerCondition: string;
  style: string;
  trackingParams: string;
  impressionEndpoints: ImpressionEndpoint[];
  isVisible: boolean;
  messageTitle: MessageTitle;
  supplementalText: SupplementalText;
}

interface MessageText {
  runs: Run[];
}

interface Run {
  text: string;
}

interface ActionButton {
  buttonRenderer: ButtonRenderer;
}

interface ButtonRenderer {
  style: string;
  size: string;
  text: Text;
  trackingParams: string;
  command: Command;
}

interface Text {
  runs: Run2[];
}

interface Run2 {
  text: string;
}

interface Command {
  clickTrackingParams: string;
  commandExecutorCommand: CommandExecutorCommand;
}

interface CommandExecutorCommand {
  commands: Command2[];
}

interface Command2 {
  clickTrackingParams?: string;
  commandMetadata: CommandMetadata6;
  browseEndpoint?: BrowseEndpoint;
  feedbackEndpoint?: FeedbackEndpoint;
}

interface CommandMetadata6 {
  webCommandMetadata: WebCommandMetadata6;
}

interface WebCommandMetadata6 {
  url?: string;
  webPageType?: string;
  rootVe?: number;
  apiUrl: string;
  sendPost?: boolean;
}

interface BrowseEndpoint {
  browseId: string;
  params: string;
}

interface FeedbackEndpoint {
  feedbackToken: string;
  uiActions: UiActions;
}

interface UiActions {
  hideEnclosingContainer: boolean;
}

interface DismissButton {
  buttonRenderer: ButtonRenderer2;
}

interface ButtonRenderer2 {
  style: string;
  size: string;
  text: Text2;
  trackingParams: string;
  command: Command3;
}

interface Text2 {
  runs: Run3[];
}

interface Run3 {
  text: string;
}

interface Command3 {
  clickTrackingParams: string;
  commandExecutorCommand: CommandExecutorCommand2;
}

interface CommandExecutorCommand2 {
  commands: Command4[];
}

interface Command4 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata7;
  feedbackEndpoint: FeedbackEndpoint2;
}

interface CommandMetadata7 {
  webCommandMetadata: WebCommandMetadata7;
}

interface WebCommandMetadata7 {
  sendPost: boolean;
  apiUrl: string;
}

interface FeedbackEndpoint2 {
  feedbackToken: string;
  uiActions: UiActions2;
}

interface UiActions2 {
  hideEnclosingContainer: boolean;
}

interface ImpressionEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata8;
  feedbackEndpoint: FeedbackEndpoint3;
}

interface CommandMetadata8 {
  webCommandMetadata: WebCommandMetadata8;
}

interface WebCommandMetadata8 {
  sendPost: boolean;
  apiUrl: string;
}

interface FeedbackEndpoint3 {
  feedbackToken: string;
  uiActions: UiActions3;
}

interface UiActions3 {
  hideEnclosingContainer: boolean;
}

interface MessageTitle {
  runs: Run4[];
}

interface Run4 {
  text: string;
}

interface SupplementalText {
  runs: Run5[];
}

interface Run5 {
  text: string;
}

interface AdPlacement {
  adPlacementRenderer: AdPlacementRenderer;
}

interface AdPlacementRenderer {
  config: Config;
  renderer: Renderer;
  adSlotLoggingData: AdSlotLoggingData;
}

interface Config {
  adPlacementConfig: AdPlacementConfig;
}

interface AdPlacementConfig {
  kind: string;
  adTimeOffset: AdTimeOffset;
  hideCueRangeMarker: boolean;
}

interface AdTimeOffset {
  offsetStartMilliseconds: string;
  offsetEndMilliseconds: string;
}

interface Renderer {
  clientForecastingAdRenderer?: ClientForecastingAdRenderer;
  adBreakServiceRenderer?: AdBreakServiceRenderer;
}

type ClientForecastingAdRenderer = object;

interface AdBreakServiceRenderer {
  prefetchMilliseconds: string;
  getAdBreakUrl: string;
}

interface AdSlotLoggingData {
  serializedSlotAdServingDataEntry: string;
}

interface FrameworkUpdates {
  entityBatchUpdate: EntityBatchUpdate;
}

interface EntityBatchUpdate {
  mutations: Mutation[];
  timestamp: Timestamp;
}

interface Mutation {
  entityKey: string;
  type: string;
  payload: Payload;
}

interface Payload {
  offlineabilityEntity: OfflineabilityEntity;
}

interface OfflineabilityEntity {
  key: string;
  addToOfflineButtonState: string;
}

interface Timestamp {
  seconds: string;
  nanos: number;
}
