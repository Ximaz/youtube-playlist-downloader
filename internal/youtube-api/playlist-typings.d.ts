declare interface RefinedPlaylistMetadata {
  playlistId: string;
  title: string;
  videos: { id: string; author: string; thumbnail: string; title: string }[];
  thumbnailUrl: string;
}

declare interface PlaylistMetadata {
  responseContext: ResponseContext;
  contents: Contents;
  header: Header;
  metadata: Metadata2 | undefined;
  trackingParams: string;
  topbar: Topbar;
  microformat: Microformat;
  sidebar: Sidebar;
}

interface ResponseContext {
  serviceTrackingParams: ServiceTrackingParam[];
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
  loggedOut: boolean;
  trackingParam: string;
}

interface WebResponseContextExtensionData {
  ytConfigData: YtConfigData;
  hasDecorated: boolean;
}

interface YtConfigData {
  visitorData: string;
  rootVisualElementType: number;
}

interface Contents {
  twoColumnBrowseResultsRenderer: TwoColumnBrowseResultsRenderer;
}

interface TwoColumnBrowseResultsRenderer {
  tabs: Tab[];
}

interface Tab {
  tabRenderer: TabRenderer;
}

interface TabRenderer {
  selected: boolean;
  content: Content;
  trackingParams: string;
}

interface Content {
  sectionListRenderer: SectionListRenderer;
}

interface SectionListRenderer {
  contents: Content2[];
  trackingParams: string;
  targetId: string;
}

interface Content2 {
  itemSectionRenderer?: ItemSectionRenderer;
  continuationItemRenderer?: ContinuationItemRenderer;
}

interface ItemSectionRenderer {
  contents: Content3[];
  trackingParams: string;
}

interface Content3 {
  playlistVideoListRenderer: PlaylistVideoListRenderer;
}

interface PlaylistVideoListRenderer {
  contents: Content4[];
  playlistId: string;
  isEditable: boolean;
  canReorder: boolean;
  trackingParams: string;
  targetId: string;
}

interface Content4 {
  playlistVideoRenderer: PlaylistVideoRenderer;
}

interface PlaylistVideoRenderer {
  videoId: string;
  thumbnail: Thumbnail;
  title: Title;
  index: Index;
  shortBylineText: ShortBylineText;
  lengthText: LengthText;
  navigationEndpoint: NavigationEndpoint2;
  lengthSeconds: string;
  trackingParams: string;
  isPlayable: boolean;
  menu: Menu;
  thumbnailOverlays: ThumbnailOverlay[];
  videoInfo: VideoInfo;
}

interface Thumbnail {
  thumbnails: Thumbnail2[];
}

interface Thumbnail2 {
  url: string;
  width: number;
  height: number;
}

interface Title {
  runs: Run[];
  accessibility: Accessibility;
}

interface Run {
  text: string;
}

interface Accessibility {
  accessibilityData: AccessibilityData;
}

interface AccessibilityData {
  label: string;
}

interface Index {
  simpleText: string;
}

interface ShortBylineText {
  runs: Run2[];
}

interface Run2 {
  text: string;
  navigationEndpoint: NavigationEndpoint;
}

interface NavigationEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata;
  browseEndpoint: BrowseEndpoint;
}

interface CommandMetadata {
  webCommandMetadata: WebCommandMetadata;
}

interface WebCommandMetadata {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint {
  browseId: string;
  canonicalBaseUrl: string;
}

interface LengthText {
  accessibility: Accessibility2;
  simpleText: string;
}

interface Accessibility2 {
  accessibilityData: AccessibilityData2;
}

interface AccessibilityData2 {
  label: string;
}

interface NavigationEndpoint2 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata2;
  watchEndpoint: WatchEndpoint;
}

interface CommandMetadata2 {
  webCommandMetadata: WebCommandMetadata2;
}

interface WebCommandMetadata2 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint {
  videoId: string;
  playlistId: string;
  index: number;
  params: string;
  playerParams: string;
  loggingContext: LoggingContext;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig;
}

interface LoggingContext {
  vssLoggingContext: VssLoggingContext;
}

interface VssLoggingContext {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig;
}

interface Html5PlaybackOnesieConfig {
  commonConfig: CommonConfig;
}

interface CommonConfig {
  url: string;
}

interface Menu {
  menuRenderer: MenuRenderer;
}

interface MenuRenderer {
  items: Item[];
  trackingParams: string;
  accessibility: Accessibility3;
}

interface Item {
  menuServiceItemRenderer?: MenuServiceItemRenderer;
  menuServiceItemDownloadRenderer?: MenuServiceItemDownloadRenderer;
}

interface MenuServiceItemRenderer {
  text: Text;
  icon: Icon;
  serviceEndpoint: ServiceEndpoint;
  trackingParams: string;
  hasSeparator?: boolean;
}

interface Text {
  runs: Run3[];
}

interface Run3 {
  text: string;
}

interface Icon {
  iconType: string;
}

interface ServiceEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata3;
  shareEntityServiceEndpoint?: ShareEntityServiceEndpoint;
  signalServiceEndpoint?: SignalServiceEndpoint;
}

interface CommandMetadata3 {
  webCommandMetadata: WebCommandMetadata3;
}

interface WebCommandMetadata3 {
  sendPost: boolean;
  apiUrl?: string;
}

interface ShareEntityServiceEndpoint {
  serializedShareEntity: string;
  commands: Command[];
}

interface Command {
  clickTrackingParams: string;
  openPopupAction: OpenPopupAction;
}

interface OpenPopupAction {
  popup: Popup;
  popupType: string;
  beReused: boolean;
}

interface Popup {
  unifiedSharePanelRenderer: UnifiedSharePanelRenderer;
}

interface UnifiedSharePanelRenderer {
  trackingParams: string;
  showLoadingSpinner: boolean;
}

interface SignalServiceEndpoint {
  signal: string;
  actions: Action[];
}

interface Action {
  clickTrackingParams: string;
  addToPlaylistCommand: AddToPlaylistCommand;
}

interface AddToPlaylistCommand {
  openMiniplayer: boolean;
  videoId: string;
  listType: string;
  onCreateListCommand: OnCreateListCommand;
  videoIds: string[];
  videoCommand: VideoCommand;
}

interface OnCreateListCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata4;
  createPlaylistServiceEndpoint: CreatePlaylistServiceEndpoint;
}

interface CommandMetadata4 {
  webCommandMetadata: WebCommandMetadata4;
}

interface WebCommandMetadata4 {
  sendPost: boolean;
  apiUrl: string;
}

interface CreatePlaylistServiceEndpoint {
  videoIds: string[];
  params: string;
}

interface VideoCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata5;
  watchEndpoint: WatchEndpoint2;
}

interface CommandMetadata5 {
  webCommandMetadata: WebCommandMetadata5;
}

interface WebCommandMetadata5 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint2 {
  videoId: string;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig2;
  playerParams?: string;
}

interface WatchEndpointSupportedOnesieConfig2 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig2;
}

interface Html5PlaybackOnesieConfig2 {
  commonConfig: CommonConfig2;
}

interface CommonConfig2 {
  url: string;
}

interface MenuServiceItemDownloadRenderer {
  serviceEndpoint: ServiceEndpoint2;
  trackingParams: string;
}

interface ServiceEndpoint2 {
  clickTrackingParams: string;
  offlineVideoEndpoint: OfflineVideoEndpoint;
}

interface OfflineVideoEndpoint {
  videoId: string;
  onAddCommand: OnAddCommand;
}

interface OnAddCommand {
  clickTrackingParams: string;
  getDownloadActionCommand: GetDownloadActionCommand;
}

interface GetDownloadActionCommand {
  videoId: string;
  params: string;
}

interface Accessibility3 {
  accessibilityData: AccessibilityData3;
}

interface AccessibilityData3 {
  label: string;
}

interface ThumbnailOverlay {
  thumbnailOverlayTimeStatusRenderer?: ThumbnailOverlayTimeStatusRenderer;
  thumbnailOverlayNowPlayingRenderer?: ThumbnailOverlayNowPlayingRenderer;
}

interface ThumbnailOverlayTimeStatusRenderer {
  text: Text2;
  style: string;
}

interface Text2 {
  accessibility: Accessibility4;
  simpleText: string;
}

interface Accessibility4 {
  accessibilityData: AccessibilityData4;
}

interface AccessibilityData4 {
  label: string;
}

interface ThumbnailOverlayNowPlayingRenderer {
  text: Text3;
}

interface Text3 {
  runs: Run4[];
}

interface Run4 {
  text: string;
}

interface VideoInfo {
  runs: Run5[];
}

interface Run5 {
  text: string;
}

interface ContinuationItemRenderer {
  trigger: string;
  continuationEndpoint: ContinuationEndpoint;
}

interface ContinuationEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata6;
  continuationCommand: ContinuationCommand;
}

interface CommandMetadata6 {
  webCommandMetadata: WebCommandMetadata6;
}

interface WebCommandMetadata6 {
  sendPost: boolean;
  apiUrl: string;
}

interface ContinuationCommand {
  token: string;
  request: string;
}

interface Header {
  pageHeaderRenderer: PageHeaderRenderer;
}

interface PageHeaderRenderer {
  pageTitle: string;
  content: Content5;
  enableSidebarView: boolean;
}

interface Content5 {
  pageHeaderViewModel: PageHeaderViewModel;
}

interface PageHeaderViewModel {
  title: Title2;
  metadata: Metadata;
  actions: Actions;
  description: Description;
  heroImage: HeroImage;
  background: Background;
  hasTopbarAnimation: boolean;
  enableFlexibleActionsButtonsWrapper: boolean;
  rendererContext: RendererContext9;
}

interface Title2 {
  dynamicTextViewModel: DynamicTextViewModel;
}

interface DynamicTextViewModel {
  text: Text4;
  rendererContext: RendererContext;
}

interface Text4 {
  content: string;
}

interface RendererContext {
  loggingContext: LoggingContext2;
}

interface LoggingContext2 {
  loggingDirectives: LoggingDirectives;
}

interface LoggingDirectives {
  trackingParams: string;
  visibility: Visibility;
  clientVeSpec: ClientVeSpec;
}

interface Visibility {
  types: string;
}

interface ClientVeSpec {
  uiType: number;
  veCounter: number;
}

interface Metadata {
  contentMetadataViewModel: ContentMetadataViewModel;
}

interface ContentMetadataViewModel {
  metadataRows: MetadataRow[];
  delimiter: string;
  rendererContext: RendererContext3;
}

interface MetadataRow {
  metadataParts: MetadataPart[];
}

interface MetadataPart {
  avatarStack?: AvatarStack;
  text?: Text6;
}

interface AvatarStack {
  avatarStackViewModel: AvatarStackViewModel;
}

interface AvatarStackViewModel {
  avatars: Avatar[];
  text: Text5;
  rendererContext: RendererContext2;
}

interface Avatar {
  avatarViewModel: AvatarViewModel;
}

interface AvatarViewModel {
  image: Image;
  avatarImageSize: string;
}

interface Image {
  sources: Source[];
  processor: Processor;
}

interface Source {
  url: string;
  width: number;
  height: number;
}

interface Processor {
  borderImageProcessor: BorderImageProcessor;
}

interface BorderImageProcessor {
  circular: boolean;
}

interface Text5 {
  content: string;
  commandRuns: CommandRun[];
  styleRuns: StyleRun[];
}

interface CommandRun {
  startIndex: number;
  length: number;
  onTap: OnTap;
}

interface OnTap {
  innertubeCommand: InnertubeCommand;
}

interface InnertubeCommand {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata7;
  browseEndpoint: BrowseEndpoint2;
}

interface CommandMetadata7 {
  webCommandMetadata: WebCommandMetadata7;
}

interface WebCommandMetadata7 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint2 {
  browseId: string;
  canonicalBaseUrl: string;
}

interface StyleRun {
  startIndex: number;
  length: number;
  fontColor: number;
  weightLabel: string;
}

interface RendererContext2 {
  loggingContext: LoggingContext3;
  accessibilityContext: AccessibilityContext;
  commandContext: CommandContext;
}

interface LoggingContext3 {
  loggingDirectives: LoggingDirectives2;
}

interface LoggingDirectives2 {
  trackingParams: string;
  visibility: Visibility2;
  clientVeSpec: ClientVeSpec2;
}

interface Visibility2 {
  types: string;
}

interface ClientVeSpec2 {
  uiType: number;
  veCounter: number;
}

interface AccessibilityContext {
  label: string;
}

interface CommandContext {
  onTap: OnTap2;
}

interface OnTap2 {
  innertubeCommand: InnertubeCommand2;
}

interface InnertubeCommand2 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata8;
  browseEndpoint: BrowseEndpoint3;
}

interface CommandMetadata8 {
  webCommandMetadata: WebCommandMetadata8;
}

interface WebCommandMetadata8 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint3 {
  browseId: string;
  canonicalBaseUrl: string;
}

interface Text6 {
  content: string;
}

interface RendererContext3 {
  loggingContext: LoggingContext4;
}

interface LoggingContext4 {
  loggingDirectives: LoggingDirectives3;
}

interface LoggingDirectives3 {
  trackingParams: string;
  visibility: Visibility3;
  clientVeSpec: ClientVeSpec3;
}

interface Visibility3 {
  types: string;
}

interface ClientVeSpec3 {
  uiType: number;
  veCounter: number;
}

interface Actions {
  flexibleActionsViewModel: FlexibleActionsViewModel;
}

interface FlexibleActionsViewModel {
  actionsRows: ActionsRow[];
  minimumRowHeight: number;
  rendererContext: RendererContext5;
}

interface ActionsRow {
  actions: Action2[];
}

interface Action2 {
  buttonViewModel?: ButtonViewModel;
  toggleButtonViewModel?: ToggleButtonViewModel;
}

interface ButtonViewModel {
  iconName: string;
  onTap: OnTap3;
  accessibilityText: string;
  style: string;
  trackingParams: string;
  isFullWidth: boolean;
  type: string;
  buttonSize: string;
  state?: string;
  enableIconButton?: boolean;
  tooltip?: string;
  title?: string;
}

interface OnTap3 {
  innertubeCommand: InnertubeCommand3;
}

interface InnertubeCommand3 {
  clickTrackingParams: string;
  showSheetCommand?: ShowSheetCommand;
  commandMetadata?: CommandMetadata10;
  shareEntityServiceEndpoint?: ShareEntityServiceEndpoint2;
  watchEndpoint?: WatchEndpoint4;
}

interface ShowSheetCommand {
  panelLoadingStrategy: PanelLoadingStrategy;
}

interface PanelLoadingStrategy {
  inlineContent: InlineContent;
}

interface InlineContent {
  sheetViewModel: SheetViewModel;
}

interface SheetViewModel {
  content: Content6;
}

interface Content6 {
  listViewModel: ListViewModel;
}

interface ListViewModel {
  listItems: ListItem[];
}

interface ListItem {
  listItemViewModel: ListItemViewModel;
}

interface ListItemViewModel {
  title: Title3;
  leadingImage: LeadingImage;
  rendererContext: RendererContext4;
}

interface Title3 {
  content: string;
}

interface LeadingImage {
  sources: Source2[];
}

interface Source2 {
  clientResource: ClientResource;
}

interface ClientResource {
  imageName: string;
}

interface RendererContext4 {
  loggingContext: LoggingContext5;
  commandContext: CommandContext2;
}

interface LoggingContext5 {
  loggingDirectives: LoggingDirectives4;
}

interface LoggingDirectives4 {
  trackingParams: string;
}

interface CommandContext2 {
  onTap: OnTap4;
}

interface OnTap4 {
  innertubeCommand: InnertubeCommand4;
}

interface InnertubeCommand4 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata9;
  watchEndpoint: WatchEndpoint3;
}

interface CommandMetadata9 {
  webCommandMetadata: WebCommandMetadata9;
}

interface WebCommandMetadata9 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint3 {
  videoId: string;
  playlistId: string;
  params: string;
  playerParams: string;
  loggingContext: LoggingContext6;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig3;
}

interface LoggingContext6 {
  vssLoggingContext: VssLoggingContext2;
}

interface VssLoggingContext2 {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig3 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig3;
}

interface Html5PlaybackOnesieConfig3 {
  commonConfig: CommonConfig3;
}

interface CommonConfig3 {
  url: string;
}

interface CommandMetadata10 {
  webCommandMetadata: WebCommandMetadata10;
}

interface WebCommandMetadata10 {
  sendPost?: boolean;
  apiUrl?: string;
  url?: string;
  webPageType?: string;
  rootVe?: number;
}

interface ShareEntityServiceEndpoint2 {
  serializedShareEntity: string;
  commands: Command2[];
}

interface Command2 {
  clickTrackingParams: string;
  openPopupAction: OpenPopupAction2;
}

interface OpenPopupAction2 {
  popup: Popup2;
  popupType: string;
  beReused: boolean;
}

interface Popup2 {
  unifiedSharePanelRenderer: UnifiedSharePanelRenderer2;
}

interface UnifiedSharePanelRenderer2 {
  trackingParams: string;
  showLoadingSpinner: boolean;
}

interface WatchEndpoint4 {
  videoId: string;
  playlistId: string;
  playerParams: string;
  loggingContext: LoggingContext7;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig4;
}

interface LoggingContext7 {
  vssLoggingContext: VssLoggingContext3;
}

interface VssLoggingContext3 {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig4 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig4;
}

interface Html5PlaybackOnesieConfig4 {
  commonConfig: CommonConfig4;
}

interface CommonConfig4 {
  url: string;
}

interface ToggleButtonViewModel {
  defaultButtonViewModel: DefaultButtonViewModel;
  toggledButtonViewModel: ToggledButtonViewModel;
  isToggled: boolean;
  identifier: string;
  trackingParams: string;
}

interface DefaultButtonViewModel {
  buttonViewModel: ButtonViewModel2;
}

interface ButtonViewModel2 {
  iconName: string;
  onTap: OnTap5;
  accessibilityText: string;
  style: string;
  trackingParams: string;
  isFullWidth: boolean;
  type: string;
  buttonSize: string;
  tooltip: string;
}

interface OnTap5 {
  innertubeCommand: InnertubeCommand5;
}

interface InnertubeCommand5 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata11;
  modalEndpoint: ModalEndpoint;
}

interface CommandMetadata11 {
  webCommandMetadata: WebCommandMetadata11;
}

interface WebCommandMetadata11 {
  ignoreNavigation: boolean;
}

interface ModalEndpoint {
  modal: Modal;
}

interface Modal {
  modalWithTitleAndButtonRenderer: ModalWithTitleAndButtonRenderer;
}

interface ModalWithTitleAndButtonRenderer {
  title: Title4;
  content: Content7;
  button: Button;
}

interface Title4 {
  simpleText: string;
}

interface Content7 {
  simpleText: string;
}

interface Button {
  buttonRenderer: ButtonRenderer;
}

interface ButtonRenderer {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text7;
  navigationEndpoint: NavigationEndpoint3;
  trackingParams: string;
}

interface Text7 {
  simpleText: string;
}

interface NavigationEndpoint3 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata12;
  signInEndpoint: SignInEndpoint;
}

interface CommandMetadata12 {
  webCommandMetadata: WebCommandMetadata12;
}

interface WebCommandMetadata12 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface SignInEndpoint {
  nextEndpoint: NextEndpoint;
  idamTag: string;
}

interface NextEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata13;
  browseEndpoint: BrowseEndpoint4;
}

interface CommandMetadata13 {
  webCommandMetadata: WebCommandMetadata13;
}

interface WebCommandMetadata13 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint4 {
  browseId: string;
}

interface ToggledButtonViewModel {
  buttonViewModel: ButtonViewModel3;
}

interface ButtonViewModel3 {
  iconName: string;
  accessibilityText: string;
  style: string;
  trackingParams: string;
  isFullWidth: boolean;
  type: string;
  buttonSize: string;
  tooltip: string;
}

interface RendererContext5 {
  loggingContext: LoggingContext8;
}

interface LoggingContext8 {
  loggingDirectives: LoggingDirectives5;
}

interface LoggingDirectives5 {
  trackingParams: string;
  visibility: Visibility4;
  clientVeSpec: ClientVeSpec4;
}

interface Visibility4 {
  types: string;
}

interface ClientVeSpec4 {
  uiType: number;
  veCounter: number;
}

interface Description {
  descriptionPreviewViewModel: DescriptionPreviewViewModel;
}

interface DescriptionPreviewViewModel {
  truncationText: TruncationText;
  rendererContext: RendererContext6;
}

interface TruncationText {
  content: string;
  styleRuns: StyleRun2[];
}

interface StyleRun2 {
  startIndex: number;
  length: number;
  weight: number;
}

interface RendererContext6 {
  loggingContext: LoggingContext9;
}

interface LoggingContext9 {
  loggingDirectives: LoggingDirectives6;
}

interface LoggingDirectives6 {
  trackingParams: string;
  visibility: Visibility5;
  clientVeSpec: ClientVeSpec5;
}

interface Visibility5 {
  types: string;
}

interface ClientVeSpec5 {
  uiType: number;
  veCounter: number;
}

interface HeroImage {
  contentPreviewImageViewModel: ContentPreviewImageViewModel;
}

interface ContentPreviewImageViewModel {
  image: Image2;
  style: string;
  layoutMode: string;
  overlays: Overlay[];
  rendererContext: RendererContext8;
}

interface Image2 {
  sources: Source3[];
}

interface Source3 {
  url: string;
  width: number;
  height: number;
}

interface Overlay {
  thumbnailHoverOverlayViewModel: ThumbnailHoverOverlayViewModel;
}

interface ThumbnailHoverOverlayViewModel {
  icon: Icon2;
  text: Text8;
  style: string;
  rendererContext: RendererContext7;
}

interface Icon2 {
  sources: Source4[];
}

interface Source4 {
  clientResource: ClientResource2;
}

interface ClientResource2 {
  imageName: string;
}

interface Text8 {
  content: string;
  styleRuns: StyleRun3[];
}

interface StyleRun3 {
  startIndex: number;
  length: number;
}

interface RendererContext7 {
  commandContext: CommandContext3;
}

interface CommandContext3 {
  onTap: OnTap6;
}

interface OnTap6 {
  innertubeCommand: InnertubeCommand6;
}

interface InnertubeCommand6 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata14;
  watchEndpoint: WatchEndpoint5;
}

interface CommandMetadata14 {
  webCommandMetadata: WebCommandMetadata14;
}

interface WebCommandMetadata14 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint5 {
  videoId: string;
  playlistId: string;
  playerParams: string;
  loggingContext: LoggingContext10;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig5;
}

interface LoggingContext10 {
  vssLoggingContext: VssLoggingContext4;
}

interface VssLoggingContext4 {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig5 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig5;
}

interface Html5PlaybackOnesieConfig5 {
  commonConfig: CommonConfig5;
}

interface CommonConfig5 {
  url: string;
}

interface RendererContext8 {
  loggingContext: LoggingContext11;
  accessibilityContext: AccessibilityContext2;
}

interface LoggingContext11 {
  loggingDirectives: LoggingDirectives7;
}

interface LoggingDirectives7 {
  trackingParams: string;
  visibility: Visibility6;
  clientVeSpec: ClientVeSpec6;
}

interface Visibility6 {
  types: string;
}

interface ClientVeSpec6 {
  uiType: number;
  veCounter: number;
}

interface AccessibilityContext2 {
  label: string;
}

interface Background {
  cinematicContainerViewModel: CinematicContainerViewModel;
}

interface CinematicContainerViewModel {
  backgroundImageConfig: BackgroundImageConfig;
  gradientColorConfig: GradientColorConfig[];
  config: Config;
}

interface BackgroundImageConfig {
  image: Image3;
}

interface Image3 {
  sources: Source5[];
}

interface Source5 {
  url: string;
  width: number;
  height: number;
}

interface GradientColorConfig {
  lightThemeColor: number;
  darkThemeColor: number;
  startLocation: number;
}

interface Config {
  lightThemeBackgroundColor: number;
  darkThemeBackgroundColor: number;
  colorSourceSizeMultiplier: number;
  applyClientImageBlur: boolean;
}

interface RendererContext9 {
  loggingContext: LoggingContext12;
}

interface LoggingContext12 {
  loggingDirectives: LoggingDirectives8;
}

interface LoggingDirectives8 {
  trackingParams: string;
  visibility: Visibility7;
  clientVeSpec: ClientVeSpec7;
}

interface Visibility7 {
  types: string;
}

interface ClientVeSpec7 {
  uiType: number;
  veCounter: number;
}

interface Metadata2 {
  playlistMetadataRenderer: PlaylistMetadataRenderer;
}

interface PlaylistMetadataRenderer {
  title: string;
  androidAppindexingLink: string;
  iosAppindexingLink: string;
}

interface Topbar {
  desktopTopbarRenderer: DesktopTopbarRenderer;
}

interface DesktopTopbarRenderer {
  logo: Logo;
  searchbox: Searchbox;
  trackingParams: string;
  countryCode: string;
  topbarButtons: TopbarButton[];
  hotkeyDialog: HotkeyDialog;
  backButton: BackButton;
  forwardButton: ForwardButton;
  a11ySkipNavigationButton: A11ySkipNavigationButton;
  voiceSearchButton: VoiceSearchButton;
}

interface Logo {
  topbarLogoRenderer: TopbarLogoRenderer;
}

interface TopbarLogoRenderer {
  iconImage: IconImage;
  tooltipText: TooltipText;
  endpoint: Endpoint;
  trackingParams: string;
  overrideEntityKey: string;
}

interface IconImage {
  iconType: string;
}

interface TooltipText {
  runs: Run6[];
}

interface Run6 {
  text: string;
}

interface Endpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata15;
  browseEndpoint: BrowseEndpoint5;
}

interface CommandMetadata15 {
  webCommandMetadata: WebCommandMetadata15;
}

interface WebCommandMetadata15 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint5 {
  browseId: string;
}

interface Searchbox {
  fusionSearchboxRenderer: FusionSearchboxRenderer;
}

interface FusionSearchboxRenderer {
  icon: Icon3;
  placeholderText: PlaceholderText;
  config: Config2;
  trackingParams: string;
  searchEndpoint: SearchEndpoint;
  clearButton: ClearButton;
}

interface Icon3 {
  iconType: string;
}

interface PlaceholderText {
  runs: Run7[];
}

interface Run7 {
  text: string;
}

interface Config2 {
  webSearchboxConfig: WebSearchboxConfig;
}

interface WebSearchboxConfig {
  requestLanguage: string;
  requestDomain: string;
  hasOnscreenKeyboard: boolean;
  focusSearchbox: boolean;
}

interface SearchEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata16;
  searchEndpoint: SearchEndpoint2;
}

interface CommandMetadata16 {
  webCommandMetadata: WebCommandMetadata16;
}

interface WebCommandMetadata16 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface SearchEndpoint2 {
  query: string;
}

interface ClearButton {
  buttonRenderer: ButtonRenderer2;
}

interface ButtonRenderer2 {
  style: string;
  size: string;
  isDisabled: boolean;
  icon: Icon4;
  trackingParams: string;
  accessibilityData: AccessibilityData5;
}

interface Icon4 {
  iconType: string;
}

interface AccessibilityData5 {
  accessibilityData: AccessibilityData6;
}

interface AccessibilityData6 {
  label: string;
}

interface TopbarButton {
  topbarMenuButtonRenderer?: TopbarMenuButtonRenderer;
  buttonRenderer?: ButtonRenderer3;
}

interface TopbarMenuButtonRenderer {
  icon: Icon5;
  menuRequest: MenuRequest;
  trackingParams: string;
  accessibility: Accessibility5;
  tooltip: string;
  style: string;
}

interface Icon5 {
  iconType: string;
}

interface MenuRequest {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata17;
  signalServiceEndpoint: SignalServiceEndpoint2;
}

interface CommandMetadata17 {
  webCommandMetadata: WebCommandMetadata17;
}

interface WebCommandMetadata17 {
  sendPost: boolean;
  apiUrl: string;
}

interface SignalServiceEndpoint2 {
  signal: string;
  actions: Action3[];
}

interface Action3 {
  clickTrackingParams: string;
  openPopupAction: OpenPopupAction3;
}

interface OpenPopupAction3 {
  popup: Popup3;
  popupType: string;
  beReused: boolean;
}

interface Popup3 {
  multiPageMenuRenderer: MultiPageMenuRenderer;
}

interface MultiPageMenuRenderer {
  trackingParams: string;
  style: string;
  showLoadingSpinner: boolean;
}

interface Accessibility5 {
  accessibilityData: AccessibilityData7;
}

interface AccessibilityData7 {
  label: string;
}

interface ButtonRenderer3 {
  style: string;
  size: string;
  text: Text9;
  icon: Icon6;
  navigationEndpoint: NavigationEndpoint4;
  trackingParams: string;
  targetId: string;
}

interface Text9 {
  runs: Run8[];
}

interface Run8 {
  text: string;
}

interface Icon6 {
  iconType: string;
}

interface NavigationEndpoint4 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata18;
  signInEndpoint: SignInEndpoint2;
}

interface CommandMetadata18 {
  webCommandMetadata: WebCommandMetadata18;
}

interface WebCommandMetadata18 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface SignInEndpoint2 {
  idamTag: string;
}

interface HotkeyDialog {
  hotkeyDialogRenderer: HotkeyDialogRenderer;
}

interface HotkeyDialogRenderer {
  title: Title5;
  sections: Section[];
  dismissButton: DismissButton;
  trackingParams: string;
}

interface Title5 {
  runs: Run9[];
}

interface Run9 {
  text: string;
}

interface Section {
  hotkeyDialogSectionRenderer: HotkeyDialogSectionRenderer;
}

interface HotkeyDialogSectionRenderer {
  title: Title6;
  options: Option[];
}

interface Title6 {
  runs: Run10[];
}

interface Run10 {
  text: string;
}

interface Option {
  hotkeyDialogSectionOptionRenderer: HotkeyDialogSectionOptionRenderer;
}

interface HotkeyDialogSectionOptionRenderer {
  label: Label;
  hotkey: string;
  hotkeyAccessibilityLabel?: HotkeyAccessibilityLabel;
}

interface Label {
  runs: Run11[];
}

interface Run11 {
  text: string;
}

interface HotkeyAccessibilityLabel {
  accessibilityData: AccessibilityData8;
}

interface AccessibilityData8 {
  label: string;
}

interface DismissButton {
  buttonRenderer: ButtonRenderer4;
}

interface ButtonRenderer4 {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text10;
  trackingParams: string;
}

interface Text10 {
  runs: Run12[];
}

interface Run12 {
  text: string;
}

interface BackButton {
  buttonRenderer: ButtonRenderer5;
}

interface ButtonRenderer5 {
  trackingParams: string;
  command: Command3;
}

interface Command3 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata19;
  signalServiceEndpoint: SignalServiceEndpoint3;
}

interface CommandMetadata19 {
  webCommandMetadata: WebCommandMetadata19;
}

interface WebCommandMetadata19 {
  sendPost: boolean;
}

interface SignalServiceEndpoint3 {
  signal: string;
  actions: Action4[];
}

interface Action4 {
  clickTrackingParams: string;
  signalAction: SignalAction;
}

interface SignalAction {
  signal: string;
}

interface ForwardButton {
  buttonRenderer: ButtonRenderer6;
}

interface ButtonRenderer6 {
  trackingParams: string;
  command: Command4;
}

interface Command4 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata20;
  signalServiceEndpoint: SignalServiceEndpoint4;
}

interface CommandMetadata20 {
  webCommandMetadata: WebCommandMetadata20;
}

interface WebCommandMetadata20 {
  sendPost: boolean;
}

interface SignalServiceEndpoint4 {
  signal: string;
  actions: Action5[];
}

interface Action5 {
  clickTrackingParams: string;
  signalAction: SignalAction2;
}

interface SignalAction2 {
  signal: string;
}

interface A11ySkipNavigationButton {
  buttonRenderer: ButtonRenderer7;
}

interface ButtonRenderer7 {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text11;
  trackingParams: string;
  command: Command5;
}

interface Text11 {
  runs: Run13[];
}

interface Run13 {
  text: string;
}

interface Command5 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata21;
  signalServiceEndpoint: SignalServiceEndpoint5;
}

interface CommandMetadata21 {
  webCommandMetadata: WebCommandMetadata21;
}

interface WebCommandMetadata21 {
  sendPost: boolean;
}

interface SignalServiceEndpoint5 {
  signal: string;
  actions: Action6[];
}

interface Action6 {
  clickTrackingParams: string;
  signalAction: SignalAction3;
}

interface SignalAction3 {
  signal: string;
}

interface VoiceSearchButton {
  buttonRenderer: ButtonRenderer8;
}

interface ButtonRenderer8 {
  style: string;
  size: string;
  isDisabled: boolean;
  serviceEndpoint: ServiceEndpoint3;
  icon: Icon8;
  tooltip: string;
  trackingParams: string;
  accessibilityData: AccessibilityData11;
}

interface ServiceEndpoint3 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata22;
  signalServiceEndpoint: SignalServiceEndpoint6;
}

interface CommandMetadata22 {
  webCommandMetadata: WebCommandMetadata22;
}

interface WebCommandMetadata22 {
  sendPost: boolean;
}

interface SignalServiceEndpoint6 {
  signal: string;
  actions: Action7[];
}

interface Action7 {
  clickTrackingParams: string;
  openPopupAction: OpenPopupAction4;
}

interface OpenPopupAction4 {
  popup: Popup4;
  popupType: string;
}

interface Popup4 {
  voiceSearchDialogRenderer: VoiceSearchDialogRenderer;
}

interface VoiceSearchDialogRenderer {
  placeholderHeader: PlaceholderHeader;
  promptHeader: PromptHeader;
  exampleQuery1: ExampleQuery1;
  exampleQuery2: ExampleQuery2;
  promptMicrophoneLabel: PromptMicrophoneLabel;
  loadingHeader: LoadingHeader;
  connectionErrorHeader: ConnectionErrorHeader;
  connectionErrorMicrophoneLabel: ConnectionErrorMicrophoneLabel;
  permissionsHeader: PermissionsHeader;
  permissionsSubtext: PermissionsSubtext;
  disabledHeader: DisabledHeader;
  disabledSubtext: DisabledSubtext;
  microphoneButtonAriaLabel: MicrophoneButtonAriaLabel;
  exitButton: ExitButton;
  trackingParams: string;
  microphoneOffPromptHeader: MicrophoneOffPromptHeader;
}

interface PlaceholderHeader {
  runs: Run14[];
}

interface Run14 {
  text: string;
}

interface PromptHeader {
  runs: Run15[];
}

interface Run15 {
  text: string;
}

interface ExampleQuery1 {
  runs: Run16[];
}

interface Run16 {
  text: string;
}

interface ExampleQuery2 {
  runs: Run17[];
}

interface Run17 {
  text: string;
}

interface PromptMicrophoneLabel {
  runs: Run18[];
}

interface Run18 {
  text: string;
}

interface LoadingHeader {
  runs: Run19[];
}

interface Run19 {
  text: string;
}

interface ConnectionErrorHeader {
  runs: Run20[];
}

interface Run20 {
  text: string;
}

interface ConnectionErrorMicrophoneLabel {
  runs: Run21[];
}

interface Run21 {
  text: string;
}

interface PermissionsHeader {
  runs: Run22[];
}

interface Run22 {
  text: string;
}

interface PermissionsSubtext {
  runs: Run23[];
}

interface Run23 {
  text: string;
}

interface DisabledHeader {
  runs: Run24[];
}

interface Run24 {
  text: string;
}

interface DisabledSubtext {
  runs: Run25[];
}

interface Run25 {
  text: string;
}

interface MicrophoneButtonAriaLabel {
  runs: Run26[];
}

interface Run26 {
  text: string;
}

interface ExitButton {
  buttonRenderer: ButtonRenderer9;
}

interface ButtonRenderer9 {
  style: string;
  size: string;
  isDisabled: boolean;
  icon: Icon7;
  trackingParams: string;
  accessibilityData: AccessibilityData9;
}

interface Icon7 {
  iconType: string;
}

interface AccessibilityData9 {
  accessibilityData: AccessibilityData10;
}

interface AccessibilityData10 {
  label: string;
}

interface MicrophoneOffPromptHeader {
  runs: Run27[];
}

interface Run27 {
  text: string;
}

interface Icon8 {
  iconType: string;
}

interface AccessibilityData11 {
  accessibilityData: AccessibilityData12;
}

interface AccessibilityData12 {
  label: string;
}

interface Microformat {
  microformatDataRenderer: MicroformatDataRenderer;
}

declare interface MicroformatDataRenderer {
  urlCanonical: string;
  title: string;
  description: string;
  thumbnail: Thumbnail3;
  siteName: string;
  appName: string;
  androidPackage: string;
  iosAppStoreId: string;
  iosAppArguments: string;
  ogType: string;
  urlApplinksWeb: string;
  urlApplinksIos: string;
  urlApplinksAndroid: string;
  urlTwitterIos: string;
  urlTwitterAndroid: string;
  twitterCardType: string;
  twitterSiteHandle: string;
  schemaDotOrgType: string;
  noindex: boolean;
  unlisted: boolean;
  linkAlternates: LinkAlternate[];
}

interface Thumbnail3 {
  thumbnails: Thumbnail4[];
  sampledThumbnailColor: SampledThumbnailColor;
  darkColorPalette: DarkColorPalette;
  vibrantColorPalette: VibrantColorPalette;
}

interface Thumbnail4 {
  url: string;
  width: number;
  height: number;
}

interface SampledThumbnailColor {
  red: number;
  green: number;
  blue: number;
}

interface DarkColorPalette {
  section2Color: number;
  iconInactiveColor: number;
  iconDisabledColor: number;
}

interface VibrantColorPalette {
  iconInactiveColor: number;
}

interface LinkAlternate {
  hrefUrl: string;
}

interface Sidebar {
  playlistSidebarRenderer: PlaylistSidebarRenderer;
}

interface PlaylistSidebarRenderer {
  items: Item2[];
  trackingParams: string;
}

interface Item2 {
  playlistSidebarPrimaryInfoRenderer?: PlaylistSidebarPrimaryInfoRenderer;
  playlistSidebarSecondaryInfoRenderer?: PlaylistSidebarSecondaryInfoRenderer;
}

interface PlaylistSidebarPrimaryInfoRenderer {
  thumbnailRenderer: ThumbnailRenderer;
  title: Title7;
  stats: Stat[];
  menu: Menu2;
  thumbnailOverlays: ThumbnailOverlay2[];
  navigationEndpoint: NavigationEndpoint10;
  badges: Badge[];
  description: Description2;
  showMoreText: ShowMoreText;
}

interface ThumbnailRenderer {
  playlistVideoThumbnailRenderer: PlaylistVideoThumbnailRenderer;
}

interface PlaylistVideoThumbnailRenderer {
  thumbnail: Thumbnail5;
  trackingParams: string;
}

interface Thumbnail5 {
  thumbnails: Thumbnail6[];
}

interface Thumbnail6 {
  url: string;
  width: number;
  height: number;
}

interface Title7 {
  runs: Run28[];
}

interface Run28 {
  text: string;
  navigationEndpoint: NavigationEndpoint5;
}

interface NavigationEndpoint5 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata23;
  watchEndpoint: WatchEndpoint6;
}

interface CommandMetadata23 {
  webCommandMetadata: WebCommandMetadata23;
}

interface WebCommandMetadata23 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint6 {
  videoId: string;
  playlistId: string;
  playerParams: string;
  loggingContext: LoggingContext13;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig6;
}

interface LoggingContext13 {
  vssLoggingContext: VssLoggingContext5;
}

interface VssLoggingContext5 {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig6 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig6;
}

interface Html5PlaybackOnesieConfig6 {
  commonConfig: CommonConfig6;
}

interface CommonConfig6 {
  url: string;
}

interface Stat {
  runs?: Run29[];
  simpleText?: string;
}

interface Run29 {
  text: string;
}

interface Menu2 {
  menuRenderer: MenuRenderer2;
}

interface MenuRenderer2 {
  items: Item3[];
  trackingParams: string;
  topLevelButtons: TopLevelButton[];
  accessibility: Accessibility7;
}

interface Item3 {
  menuNavigationItemRenderer: MenuNavigationItemRenderer;
}

interface MenuNavigationItemRenderer {
  text: Text12;
  icon: Icon9;
  navigationEndpoint: NavigationEndpoint6;
  trackingParams: string;
}

interface Text12 {
  simpleText: string;
}

interface Icon9 {
  iconType: string;
}

interface NavigationEndpoint6 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata24;
  modalEndpoint: ModalEndpoint2;
}

interface CommandMetadata24 {
  webCommandMetadata: WebCommandMetadata24;
}

interface WebCommandMetadata24 {
  ignoreNavigation: boolean;
}

interface ModalEndpoint2 {
  modal: Modal2;
}

interface Modal2 {
  modalWithTitleAndButtonRenderer: ModalWithTitleAndButtonRenderer2;
}

interface ModalWithTitleAndButtonRenderer2 {
  title: Title8;
  content: Content8;
  button: Button2;
}

interface Title8 {
  simpleText: string;
}

interface Content8 {
  simpleText: string;
}

interface Button2 {
  buttonRenderer: ButtonRenderer10;
}

interface ButtonRenderer10 {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text13;
  navigationEndpoint: NavigationEndpoint7;
  trackingParams: string;
}

interface Text13 {
  runs: Run30[];
}

interface Run30 {
  text: string;
}

interface NavigationEndpoint7 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata25;
  signInEndpoint: SignInEndpoint3;
}

interface CommandMetadata25 {
  webCommandMetadata: WebCommandMetadata25;
}

interface WebCommandMetadata25 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface SignInEndpoint3 {
  nextEndpoint: NextEndpoint2;
}

interface NextEndpoint2 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata26;
  browseEndpoint: BrowseEndpoint6;
}

interface CommandMetadata26 {
  webCommandMetadata: WebCommandMetadata26;
}

interface WebCommandMetadata26 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint6 {
  browseId: string;
}

interface TopLevelButton {
  toggleButtonRenderer?: ToggleButtonRenderer;
  buttonRenderer?: ButtonRenderer12;
}

interface ToggleButtonRenderer {
  style: Style;
  size: Size;
  isToggled: boolean;
  isDisabled: boolean;
  defaultIcon: DefaultIcon;
  toggledIcon: ToggledIcon;
  trackingParams: string;
  defaultTooltip: string;
  toggledTooltip: string;
  defaultNavigationEndpoint: DefaultNavigationEndpoint;
  accessibilityData: AccessibilityData13;
  toggledAccessibilityData: ToggledAccessibilityData;
}

interface Style {
  styleType: string;
}

interface Size {
  sizeType: string;
}

interface DefaultIcon {
  iconType: string;
}

interface ToggledIcon {
  iconType: string;
}

interface DefaultNavigationEndpoint {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata27;
  modalEndpoint: ModalEndpoint3;
}

interface CommandMetadata27 {
  webCommandMetadata: WebCommandMetadata27;
}

interface WebCommandMetadata27 {
  ignoreNavigation: boolean;
}

interface ModalEndpoint3 {
  modal: Modal3;
}

interface Modal3 {
  modalWithTitleAndButtonRenderer: ModalWithTitleAndButtonRenderer3;
}

interface ModalWithTitleAndButtonRenderer3 {
  title: Title9;
  content: Content9;
  button: Button3;
}

interface Title9 {
  simpleText: string;
}

interface Content9 {
  simpleText: string;
}

interface Button3 {
  buttonRenderer: ButtonRenderer11;
}

interface ButtonRenderer11 {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text14;
  navigationEndpoint: NavigationEndpoint8;
  trackingParams: string;
}

interface Text14 {
  simpleText: string;
}

interface NavigationEndpoint8 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata28;
  signInEndpoint: SignInEndpoint4;
}

interface CommandMetadata28 {
  webCommandMetadata: WebCommandMetadata28;
}

interface WebCommandMetadata28 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface SignInEndpoint4 {
  nextEndpoint: NextEndpoint3;
  idamTag: string;
}

interface NextEndpoint3 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata29;
  browseEndpoint: BrowseEndpoint7;
}

interface CommandMetadata29 {
  webCommandMetadata: WebCommandMetadata29;
}

interface WebCommandMetadata29 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint7 {
  browseId: string;
}

interface AccessibilityData13 {
  accessibilityData: AccessibilityData14;
}

interface AccessibilityData14 {
  label: string;
}

interface ToggledAccessibilityData {
  accessibilityData: AccessibilityData15;
}

interface AccessibilityData15 {
  label: string;
}

interface ButtonRenderer12 {
  style: string;
  size: string;
  isDisabled: boolean;
  serviceEndpoint?: ServiceEndpoint4;
  icon: Icon10;
  accessibility: Accessibility6;
  tooltip: string;
  trackingParams: string;
  navigationEndpoint?: NavigationEndpoint9;
}

interface ServiceEndpoint4 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata30;
  shareEntityServiceEndpoint: ShareEntityServiceEndpoint3;
}

interface CommandMetadata30 {
  webCommandMetadata: WebCommandMetadata30;
}

interface WebCommandMetadata30 {
  sendPost: boolean;
  apiUrl: string;
}

interface ShareEntityServiceEndpoint3 {
  serializedShareEntity: string;
  commands: Command6[];
}

interface Command6 {
  clickTrackingParams: string;
  openPopupAction: OpenPopupAction5;
}

interface OpenPopupAction5 {
  popup: Popup5;
  popupType: string;
  beReused: boolean;
}

interface Popup5 {
  unifiedSharePanelRenderer: UnifiedSharePanelRenderer3;
}

interface UnifiedSharePanelRenderer3 {
  trackingParams: string;
  showLoadingSpinner: boolean;
}

interface Icon10 {
  iconType: string;
}

interface Accessibility6 {
  label: string;
}

interface NavigationEndpoint9 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata31;
  watchEndpoint: WatchEndpoint7;
}

interface CommandMetadata31 {
  webCommandMetadata: WebCommandMetadata31;
}

interface WebCommandMetadata31 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint7 {
  videoId: string;
  playlistId: string;
  params: string;
  playerParams: string;
  loggingContext: LoggingContext14;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig7;
}

interface LoggingContext14 {
  vssLoggingContext: VssLoggingContext6;
}

interface VssLoggingContext6 {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig7 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig7;
}

interface Html5PlaybackOnesieConfig7 {
  commonConfig: CommonConfig7;
}

interface CommonConfig7 {
  url: string;
}

interface Accessibility7 {
  accessibilityData: AccessibilityData16;
}

interface AccessibilityData16 {
  label: string;
}

interface ThumbnailOverlay2 {
  thumbnailOverlaySidePanelRenderer: ThumbnailOverlaySidePanelRenderer;
}

interface ThumbnailOverlaySidePanelRenderer {
  text: Text15;
  icon: Icon11;
}

interface Text15 {
  simpleText: string;
}

interface Icon11 {
  iconType: string;
}

interface NavigationEndpoint10 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata32;
  watchEndpoint: WatchEndpoint8;
}

interface CommandMetadata32 {
  webCommandMetadata: WebCommandMetadata32;
}

interface WebCommandMetadata32 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface WatchEndpoint8 {
  videoId: string;
  playlistId: string;
  playerParams: string;
  loggingContext: LoggingContext15;
  watchEndpointSupportedOnesieConfig: WatchEndpointSupportedOnesieConfig8;
}

interface LoggingContext15 {
  vssLoggingContext: VssLoggingContext7;
}

interface VssLoggingContext7 {
  serializedContextData: string;
}

interface WatchEndpointSupportedOnesieConfig8 {
  html5PlaybackOnesieConfig: Html5PlaybackOnesieConfig8;
}

interface Html5PlaybackOnesieConfig8 {
  commonConfig: CommonConfig8;
}

interface CommonConfig8 {
  url: string;
}

interface Badge {
  metadataBadgeRenderer: MetadataBadgeRenderer;
}

interface MetadataBadgeRenderer {
  icon: Icon12;
  style: string;
  label: string;
  trackingParams: string;
}

interface Icon12 {
  iconType: string;
}

type Description2 = object; // Unknown details.

interface ShowMoreText {
  runs: Run31[];
}

interface Run31 {
  text: string;
}

interface PlaylistSidebarSecondaryInfoRenderer {
  videoOwner: VideoOwner;
  button: Button4;
}

interface VideoOwner {
  videoOwnerRenderer: VideoOwnerRenderer;
}

interface VideoOwnerRenderer {
  thumbnail: Thumbnail7;
  title: Title10;
  navigationEndpoint: NavigationEndpoint12;
  trackingParams: string;
}

interface Thumbnail7 {
  thumbnails: Thumbnail8[];
}

interface Thumbnail8 {
  url: string;
  width: number;
  height: number;
}

interface Title10 {
  runs: Run32[];
}

interface Run32 {
  text: string;
  navigationEndpoint: NavigationEndpoint11;
}

interface NavigationEndpoint11 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata33;
  browseEndpoint: BrowseEndpoint8;
}

interface CommandMetadata33 {
  webCommandMetadata: WebCommandMetadata33;
}

interface WebCommandMetadata33 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint8 {
  browseId: string;
  canonicalBaseUrl: string;
}

interface NavigationEndpoint12 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata34;
  browseEndpoint: BrowseEndpoint9;
}

interface CommandMetadata34 {
  webCommandMetadata: WebCommandMetadata34;
}

interface WebCommandMetadata34 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint9 {
  browseId: string;
  canonicalBaseUrl: string;
}

interface Button4 {
  buttonRenderer: ButtonRenderer13;
}

interface ButtonRenderer13 {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text16;
  navigationEndpoint: NavigationEndpoint13;
  trackingParams: string;
}

interface Text16 {
  runs: Run33[];
}

interface Run33 {
  text: string;
}

interface NavigationEndpoint13 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata35;
  modalEndpoint: ModalEndpoint4;
}

interface CommandMetadata35 {
  webCommandMetadata: WebCommandMetadata35;
}

interface WebCommandMetadata35 {
  ignoreNavigation: boolean;
}

interface ModalEndpoint4 {
  modal: Modal4;
}

interface Modal4 {
  modalWithTitleAndButtonRenderer: ModalWithTitleAndButtonRenderer4;
}

interface ModalWithTitleAndButtonRenderer4 {
  title: Title11;
  content: Content10;
  button: Button5;
}

interface Title11 {
  simpleText: string;
}

interface Content10 {
  simpleText: string;
}

interface Button5 {
  buttonRenderer: ButtonRenderer14;
}

interface ButtonRenderer14 {
  style: string;
  size: string;
  isDisabled: boolean;
  text: Text17;
  navigationEndpoint: NavigationEndpoint14;
  trackingParams: string;
}

interface Text17 {
  simpleText: string;
}

interface NavigationEndpoint14 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata36;
  signInEndpoint: SignInEndpoint5;
}

interface CommandMetadata36 {
  webCommandMetadata: WebCommandMetadata36;
}

interface WebCommandMetadata36 {
  url: string;
  webPageType: string;
  rootVe: number;
}

interface SignInEndpoint5 {
  nextEndpoint: NextEndpoint4;
  continueAction: string;
  idamTag: string;
}

interface NextEndpoint4 {
  clickTrackingParams: string;
  commandMetadata: CommandMetadata37;
  browseEndpoint: BrowseEndpoint10;
}

interface CommandMetadata37 {
  webCommandMetadata: WebCommandMetadata37;
}

interface WebCommandMetadata37 {
  url: string;
  webPageType: string;
  rootVe: number;
  apiUrl: string;
}

interface BrowseEndpoint10 {
  browseId: string;
}
