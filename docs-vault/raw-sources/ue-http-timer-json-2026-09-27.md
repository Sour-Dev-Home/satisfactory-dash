Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/ (Unreal Engine 5.6 documentation, Epic Developer Community)
Captured: 2026-09-27T05:29:45Z
Method: curl of each page, then HTML to text (tags removed). Version: the documentation for Unreal Engine 5.6 (application_version=5.6); SML's docs name 5.6.1 with Coffee Stain's changes, and Coffee Stain's custom engine can differ from the public 5.6 API pages.
Item 5: for the game's UE version, the HTTP module reference (request, response), the timer or ticker reference, and JSON serialisation.
Convention: each captured item sits between a BEGIN line and an END line written by the capture (they are not part of the source); everything between them is the source text, unedited (a final newline is added when the source file has none), with one exception: a line holding an example file path that this repository's PII scan rejects is replaced by an '[OMITTED by the capture ...]' marker (only the FAQ in sml-dedicated-servers-2026-09-27.adoc has such lines).
NOT FOUND (recorded, not guessed):
  - TLS / certificate verification behaviour of the HTTP module: none of the captured HTTP pages (FHttpModule, IHttpRequest, IHttpResponse, IHttpBase, FHttpManager) mentions certificates, TLS, SSL or verification. [NEEDS VERIFICATION before claim C3.]
  - https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Json/Serialization/FJsonSerializer and .../Runtime/Json/Dom/FJsonObject: the pages return only an empty shell for 5.6 (17 characters of text); the JSON serialiser page that does have content is under Runtime/Json/FJsonSerializer.
  - FTSTicker at .../Runtime/Core/Containers/FTSTicker: empty shell; the page with content is Runtime/Core/FTSTicker.
---

##### BEGIN UE 5.6 API: Runtime/HTTP/FHttpModule #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/FHttpModule?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
FHttpModule | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FHttpModule
FHttpModule
Module for Http request implementations Use FHttpFactory to create a new Http request
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Module for Http request implementations Use FHttpFactory to create a new Http request
Name
FHttpModule
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/HttpModule.h
Include Path
#include "HttpModule.h"
Syntax
class FHttpModule :
public IModuleInterface ,
public FSelfRegisteringExec
Copy full snippet
class FHttpModule :
public IModuleInterface ,
public FSelfRegisteringExec
Inheritance Hierarchy
FExec → FSelfRegisteringExec → FHttpModule
Implements Interfaces
IModuleInterface
Constants
Name
Type
Remarks
Include Path
Singleton
FHttpModule *
Singleton for the module while loaded and available
HttpModule.h
Variables
Protected
Name
Type
Remarks
Include Path
Unreal Specifiers
AllowedDomains
TArray < FString >
List of domains that can be accessed. If Empty then no filtering is applied
HttpModule.h
bEnableHttp
bool
Toggles http requests
HttpModule.h
bSupportsDynamicProxy
bool
Whether or not the http implementation we are using supports dynamic proxy setting.
HttpModule.h
bUseNullHttp
bool
Toggles null (mock) http requests
HttpModule.h
DefaultHeaders
TMap < FString, FString >
Default headers - each request will include these headers, using the default value if not overridden
HttpModule.h
HttpDelayTime
float
Total time to delay the request
HttpModule.h
HttpEventLoopThreadTickIntervalInSeconds
float
Time in seconds between explicit calls to tick requests when using an event loop to run http requests.
HttpModule.h
HttpManager
FHttpManager *
Keeps track of Http requests while they are being processed
HttpModule.h
HttpMaxConnectionsPerServer
int32
Max number of simultaneous connections to a specific server
HttpModule.h
HttpNoProxy
FString
The domains which won't use proxy even if the ProxyAddress is set, in format "127.0.0.1,localhost,example.com"
HttpModule.h
HttpReceiveTimeout
float
Timeout in seconds to receive a response on the connection
HttpModule.h
HttpSendTimeout
float
Timeout in seconds to send a request on the connection
HttpModule.h
HttpThreadActiveFrameTimeInSeconds
float
Time in seconds to use as frame time when actively processing requests. 0 means no frame time.
HttpModule.h
HttpThreadActiveMinimumSleepTimeInSeconds
float
Time in seconds to sleep minimally when actively processing requests.
HttpModule.h
HttpThreadIdleFrameTimeInSeconds
float
Time in seconds to use as frame time when idle, waiting for requests. 0 means no frame time.
HttpModule.h
HttpThreadIdleMinimumSleepTimeInSeconds
float
Time in seconds to sleep minimally when idle, waiting for requests.
HttpModule.h
MaxReadBufferSize
int32
Max buffer size for individual http reads
HttpModule.h
ProxyAddress
FString
The address to use for proxy, in format IPADDRESS:PORT
HttpModule.h
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
void AddDefaultHeader
(
const FString& HeaderName,
const FString& HeaderValue
)
Add a default header to be appended to future requests If a request already specifies this header, then the defaulted version will not be used
HttpModule.h
virtual TSharedRef < IHttpRequest , ESPMode::ThreadSafe > CreateRequest()
Instantiates a new Http request for the current platform
HttpModule.h
const TMap < FString, FString > & GetDefaultHeaders()
Get the default headers that are appended to every request
HttpModule.h
float GetHttpActivityTimeout()
HttpModule.h
float GetHttpConnectionTimeout()
HttpModule.h
float GetHttpDelayTime()
HttpModule.h
float GetHttpEventLoopThreadTickIntervalInSeconds()
HttpModule.h
FHttpManager & GetHttpManager()
Only meant to be used by Http request/response implementations
HttpModule.h
int32 GetHttpMaxConnectionsPerServer()
HttpModule.h
const FString & GetHttpNoProxy()
HttpModule.h
float GetHttpThreadActiveFrameTimeInSeconds()
HttpModule.h
float GetHttpThreadActiveMinimumSleepTimeInSeconds()
HttpModule.h
float GetHttpThreadIdleFrameTimeInSeconds()
HttpModule.h
float GetHttpThreadIdleMinimumSleepTimeInSeconds()
HttpModule.h
float GetHttpTotalTimeout()
HttpModule.h
int32 GetMaxReadBufferSize()
HttpModule.h
const FString & GetProxyAddress()
HttpModule.h
bool HandleHTTPCommand
(
const TCHAR* Cmd,
FOutputDevice & Ar
)
Exec command handlers
HttpModule.h
bool IsHttpEnabled()
HttpModule.h
bool IsNullHttpEnabled()
HttpModule.h
void SetHttpDelayTime
(
float InHttpDelayTime
)
Set the min delay time for each http request
HttpModule.h
void SetHttpThreadActiveFrameTimeInSeconds
(
float InHttpThreadActiveFrameTimeInSeconds
)
Set the target tick rate of an active http thread
HttpModule.h
void SetHttpThreadActiveMinimumSleepTimeInSeconds
(
float InHttpThreadActiveMinimumSleepTimeInSeconds
)
Set the minimum sleep time of an active http thread
HttpModule.h
void SetHttpThreadIdleFrameTimeInSeconds
(
float InHttpThreadIdleFrameTimeInSeconds
)
Set the target tick rate of an idle http thread
HttpModule.h
void SetHttpThreadIdleMinimumSleepTimeInSeconds
(
float InHttpThreadIdleMinimumSleepTimeInSeconds
)
Set the minimum sleep time when idle, waiting for requests
HttpModule.h
void SetMaxReadBufferSize
(
int32 SizeInBytes
)
Sets the maximum size for the read buffer
HttpModule.h
void SetProxyAddress
(
const FString& InProxyAddress
)
Setter for the proxy address.
HttpModule.h
bool SupportsDynamicProxy()
Method to check dynamic proxy setting support.
HttpModule.h
void ToggleNullHttp
(
bool bEnabled
)
Toggle null http implementation
HttpModule.h
void UpdateConfigs()
Update all config-based values
HttpModule.h
Overridden from IModuleInterface
Name
Remarks
Include Path
Unreal Specifiers
virtual void PostLoadCallback()
Called after Http module is loaded Initialize platform specific parts of Http handling
HttpModule.h
virtual void PreUnloadCallback()
Called before Http module is unloaded Shutdown platform specific parts of Http handling
HttpModule.h
virtual void ShutdownModule()
Called when Http module is unloaded
HttpModule.h
virtual void StartupModule()
Called when Http module is loaded load dependant modules
HttpModule.h
Protected
Overridden from FExec
Name
Remarks
Include Path
Unreal Specifiers
virtual bool Exec_Runtime
(
UWorld* InWorld,
const TCHAR* Cmd,
FOutputDevice & Ar
)
Handle exec commands starting with "HTTP"
HttpModule.h
Static
Name
Remarks
Include Path
Unreal Specifiers
static FHttpModule & Get ()
Singleton-like access to this module's interface.
HttpModule.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Inheritance Hierarchy
Implements Interfaces
Constants
Variables
Protected
Functions
Public
Overridden from IModuleInterface
Protected
Overridden from FExec
Static
##### END UE 5.6 API: Runtime/HTTP/FHttpModule #####

##### BEGIN UE 5.6 API: Runtime/HTTP/IHttpRequest #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/IHttpRequest?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
IHttpRequest | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
IHttpRequest
IHttpRequest
Interface for Http requests (created using FHttpFactory)
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Interface for Http requests (created using FHttpFactory)
Name
IHttpRequest
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/Interfaces/IHttpRequest.h
Include Path
#include "Interfaces/IHttpRequest.h"
Syntax
class IHttpRequest :
public IHttpBase ,
public TSharedFromThis< IHttpRequest, ESPMode::ThreadSafe >
Copy full snippet
class IHttpRequest :
public IHttpBase ,
public TSharedFromThis< IHttpRequest, ESPMode::ThreadSafe >
Inheritance Hierarchy
FSharedFromThisBase → TSharedFromThis → IHttpRequest
Implements Interfaces
IHttpBase
Derived Classes
FHttpRequestImpl
Destructors
Name
Remarks
Include Path
Unreal Specifiers
virtual ~IHttpRequest()
Destructor for overrides
Interfaces/IHttpRequest.h
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
void AppendToHeader
(
const FString& HeaderName,
const FString& AdditionalHeaderValue
)
Appends to the value already set in the header.
Interfaces/IHttpRequest.h
void CancelRequest()
Called to cancel a request that is still being processed
Interfaces/IHttpRequest.h
void ClearTimeout()
Clears the optional timeout in seconds for this HTTP request, causing the default value from FHttpModule::GetTimeout() to be used.
Interfaces/IHttpRequest.h
EHttpRequestDelegateThreadPolicy GetDelegateThreadPolicy()
Get thread policy about which thread to complete this request
Interfaces/IHttpRequest.h
float GetElapsedTime()
Gets the time that it took for the server to fully respond to the request.
Interfaces/IHttpRequest.h
FString GetOption
(
const FName Option
) const
Get the current value for the given option
Interfaces/IHttpRequest.h
const FHttpResponsePtr GetResponse()
Get the associated Response
Interfaces/IHttpRequest.h
TOptional < float > GetTimeout ()
Gets the optional timeout in seconds for this entire HTTP request to complete.
Interfaces/IHttpRequest.h
FString GetVerb()
Gets the verb (GET, PUT, POST) used by the request.
Interfaces/IHttpRequest.h
FHttpRequestHeaderReceivedDelegate & OnHeaderReceived()
Delegate called to signal the receipt of a header. See FHttpRequestHeaderReceivedDelegate
Interfaces/IHttpRequest.h
FHttpRequestCompleteDelegate & OnProcessRequestComplete()
Delegate called when the request is complete. See FHttpRequestCompleteDelegate
Interfaces/IHttpRequest.h
FHttpRequestProgressDelegate64 & OnRequestProgress64()
Delegate called to update the request/response progress. See FHttpRequestProgressDelegate64
Interfaces/IHttpRequest.h
FHttpRequestWillRetryDelegate & OnRequestWillRetry()
Delegate called when the request will be retried
Interfaces/IHttpRequest.h
FHttpRequestStatusCodeReceivedDelegate & OnStatusCodeReceived()
Delegate called to signal the receipt of a header. See FHttpRequestStatusCodeReceivedDelegate
Interfaces/IHttpRequest.h
bool ProcessRequest ()
Called to begin processing the request.
Interfaces/IHttpRequest.h
void ProcessRequestUntilComplete ()
Blocking call to wait the request until it's completed
Interfaces/IHttpRequest.h
void ResetTimeoutStatus()
Reset the elapsed timeout duration and flag, after the request completed and need to be reused
Interfaces/IHttpRequest.h
void SetActivityTimeout
(
float InTimeoutSecs
)
Sets an optional activity timeout in seconds for this HTTP request.
Interfaces/IHttpRequest.h
void SetContent
(
const TArray < uint8 >& ContentPayload
)
Sets the content of the request (optional data). Usually only set for POST requests.
Interfaces/IHttpRequest.h
void SetContent
(
TArray < uint8 >&& ContentPayload
)
Sets the content of the request (optional data).
Interfaces/IHttpRequest.h
bool SetContentAsStreamedFile
(
const FString& Filename
)
Sets the content of the request to stream from a file.
Interfaces/IHttpRequest.h
void SetContentAsString
(
const FString& ContentString
)
Sets the content of the request as a string encoded as UTF8.
Interfaces/IHttpRequest.h
bool SetContentFromStream
(
TSharedRef < FArchive , ESPMode::ThreadSafe > Stream
)
Sets the content of the request to stream directly from an archive.
Interfaces/IHttpRequest.h
bool SetContentFromStreamDelegate
(
FHttpRequestStreamDelegate StreamDelegate
)
Sets the content of the request to stream directly from an delegate.
Interfaces/IHttpRequest.h
void SetDelegateThreadPolicy
(
EHttpRequestDelegateThreadPolicy InThreadPolicy
)
Set thread policy about which thread to trigger the delegates, set by FHttpManager::SetRequestCompletedDelegate , IHttpRequest::OnStatusCodeReceived, IHttpRequest::OnHeaderReceived, IHttpRequest::OnRequestProgress64 and IHttpRequest::OnProcessRequestComplete.
Interfaces/IHttpRequest.h
void SetHeader
(
const FString& HeaderName,
const FString& HeaderValue
)
Sets optional header info.
Interfaces/IHttpRequest.h
void SetOption
(
const FName Option,
const FString& OptionValue
)
Sets the given option for this Request Must be set before calling ProcessRequest.
Interfaces/IHttpRequest.h
bool SetResponseBodyReceiveStream
(
TSharedRef < FArchive > Stream
)
Sets the stream to receive the response body.
Interfaces/IHttpRequest.h
bool SetResponseBodyReceiveStreamDelegate
(
FHttpRequestStreamDelegate StreamDelegate
)
Sets the delegate to receive the response body.
Interfaces/IHttpRequest.h
bool SetResponseBodyReceiveStreamDelegateV2
(
FHttpRequestStreamDelegateV2 StreamDelegate
)
Sets the delegate to receive the response body.
Interfaces/IHttpRequest.h
void SetTimeout
(
float InTimeoutSecs
)
Sets an optional timeout in seconds for this entire HTTP request to complete.
Interfaces/IHttpRequest.h
void SetURL
(
const FString& URL
)
Sets the URL for the request Eg.
Interfaces/IHttpRequest.h
void SetVerb
(
const FString& Verb
)
Sets the verb used by the request.
Interfaces/IHttpRequest.h
void Tick
(
float DeltaSeconds
)
Used to tick the request
Interfaces/IHttpRequest.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Inheritance Hierarchy
Implements Interfaces
Derived Classes
Destructors
Functions
Public
##### END UE 5.6 API: Runtime/HTTP/IHttpRequest #####

##### BEGIN UE 5.6 API: Runtime/HTTP/IHttpResponse #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/IHttpResponse?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
IHttpResponse | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
IHttpResponse
IHttpResponse
Interface for Http responses that come back after starting an Http request
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Interface for Http responses that come back after starting an Http request
Name
IHttpResponse
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/Interfaces/IHttpResponse.h
Include Path
#include "Interfaces/IHttpResponse.h"
Syntax
class IHttpResponse : public IHttpBase
Copy full snippet
class IHttpResponse : public IHttpBase
Implements Interfaces
IHttpBase
Destructors
Name
Remarks
Include Path
Unreal Specifiers
virtual ~IHttpResponse()
Destructor for overrides
Interfaces/IHttpResponse.h
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
FString GetContentAsString()
Returns the payload as a string, assuming the payload is UTF8.
Interfaces/IHttpResponse.h
FUtf8StringView GetContentAsUtf8StringView ()
Returns the payload as a utf8 string view.
Interfaces/IHttpResponse.h
int32 GetResponseCode ()
Gets the response code returned by the requested server.
Interfaces/IHttpResponse.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Implements Interfaces
Destructors
Functions
Public
##### END UE 5.6 API: Runtime/HTTP/IHttpResponse #####

##### BEGIN UE 5.6 API: Runtime/HTTP/IHttpBase #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/IHttpBase?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
IHttpBase | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
IHttpBase
IHttpBase
Base interface for Http Requests and Responses.
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Base interface for Http Requests and Responses.
Name
IHttpBase
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/Interfaces/IHttpBase.h
Include Path
#include "Interfaces/IHttpBase.h"
Syntax
class IHttpBase
Copy full snippet
class IHttpBase
Derived Classes
IHttpRequest
IHttpResponse
Destructors
Name
Remarks
Include Path
Unreal Specifiers
virtual ~IHttpBase()
Destructor for overrides
Interfaces/IHttpBase.h
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
TArray < FString > GetAllHeaders()
Return all headers in an array in "Name: Value" format.
Interfaces/IHttpBase.h
const TArray < uint8 > & GetContent()
Get the content payload of the request or response.
Interfaces/IHttpBase.h
uint64 GetContentLength ()
Shortcut to get the Content-Length header value.
Interfaces/IHttpBase.h
FString GetContentType()
Shortcut to get the Content-Type header value (if available)
Interfaces/IHttpBase.h
const FString & GetEffectiveURL()
Get the effective URL in case of redirected. If not redirected, it's the same as GetURL
Interfaces/IHttpBase.h
EHttpFailureReason GetFailureReason()
Get the reason of th failure if GetStatus returns Failed
Interfaces/IHttpBase.h
FString GetHeader
(
const FString& HeaderName
) const
Gets the value of a header, or empty string if not found.
Interfaces/IHttpBase.h
EHttpRequestStatus::Type GetStatus()
Get the current status of the request being processed
Interfaces/IHttpBase.h
const FString & GetURL()
Get the URL used to send the request.
Interfaces/IHttpBase.h
FString GetURLParameter
(
const FString& ParameterName
) const
Gets an URL parameter.
Interfaces/IHttpBase.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Derived Classes
Destructors
Functions
Public
##### END UE 5.6 API: Runtime/HTTP/IHttpBase #####

##### BEGIN UE 5.6 API: Runtime/HTTP/FHttpManager #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/HTTP/FHttpManager?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
FHttpManager | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FHttpManager
FHttpManager
Manages Http request that are currently being processed
On this page Navigation
API > API/Runtime > API/Runtime/HTTP
Manages Http request that are currently being processed
Name
FHttpManager
Type
class
Header File
/Engine/Source/Runtime/Online/HTTP/Public/HttpManager.h
Include Path
#include "HttpManager.h"
Syntax
class FHttpManager : public FTSTickerObjectBase
Copy full snippet
class FHttpManager : public FTSTickerObjectBase
Inheritance Hierarchy
FTSTickerObjectBase → FHttpManager
Constructors
Name
Remarks
Include Path
Unreal Specifiers
FHttpManager()
Constructor
HttpManager.h
Destructors
Name
Remarks
Include Path
Unreal Specifiers
virtual ~FHttpManager()
Destructor
HttpManager.h
Structs
Name
Remarks
FHttpFlushTimeLimit
FHttpStatsHistory
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
void AddGameThreadTask
(
TFunction < void()>&& Task,
float Delay
)
Add task to be ran on the game thread next tick
HttpManager.h
TSharedPtr < IHttpTaskTimerHandle > AddHttpThreadTask
(
TFunction < void()>&& Task,
float InDelay
)
Add task to be ran on the http thread
HttpManager.h
void AddThreadedRequest
(
const TSharedRef < FHttpRequestCommon, ESPMode::ThreadSafe >& Request
)
Add a http request to be executed on the http thread
HttpManager.h
void CancelThreadedRequest
(
const TSharedRef < FHttpRequestCommon, ESPMode::ThreadSafe >& Request
)
Mark a threaded http request as cancelled to be removed from the http thread
HttpManager.h
FString CreateCorrelationId()
Create a new correlation id for a request
HttpManager.h
void DumpRequests
(
FOutputDevice & Ar
) const
List all of the Http requests currently being processed
HttpManager.h
void Flush
(
EHttpFlushReason FlushReason
)
Block until all pending requests are finished processing
HttpManager.h
virtual void FlushTick
(
float DeltaSeconds
)
Tick called during Flush
HttpManager.h
FHttpStats GetHttpStats()
HttpManager.h
void Initialize()
Initialize
HttpManager.h
bool IsDomainAllowed
(
const FString& Url
) const
Determine if the domain is allowed to be accessed
HttpManager.h
bool IsValidRequest
(
const IHttpRequest * RequestPtr
) const
Find an Http request in the lists of current valid requests
HttpManager.h
virtual void OnAfterFork ()
Inform that HTTP Manager that we have completed a fork().
HttpManager.h
virtual void OnBeforeFork ()
Inform that HTTP Manager that we are about to fork().
HttpManager.h
virtual void OnEndFramePostFork ()
Inform the HTTP Manager that we finished ticking right after forking.
HttpManager.h
void RemoveHttpThreadTask
(
TSharedPtr < IHttpTaskTimerHandle > HttpTaskTimerHandle
)
Remove the task from the http thread before it's triggered
HttpManager.h
void RemoveRequest
(
const FHttpRequestRef& Request
)
Removes an Http request instance from the manager Presumably it is done being processed
HttpManager.h
void SetCorrelationIdMethod
(
TFunction < FString()> InCorrelationIdMethod
)
Set the method used to set a Correlation id on each request, if one is not already specified.
HttpManager.h
void SetRequestAddedDelegate
(
const FHttpManagerRequestAddedDelegate& Delegate
)
Set a delegate to be triggered when an http request added to http manager.
HttpManager.h
void SetRequestCompletedDelegate
(
const FHttpManagerRequestCompletedDelegate& Delegate
)
Set a delegate to be triggered when an http request completed.
HttpManager.h
void SetURLRequestFilter
(
const UE::Core::FURLRequestFilter & InURLRequestFilter
)
Set url request filter through code, instead of setting it through config.
HttpManager.h
void Shutdown()
Shutdown logic should be called before quiting
HttpManager.h
virtual bool SupportsDynamicProxy()
Method to check dynamic proxy setting support.
HttpManager.h
virtual void UpdateConfigs()
Update configuration. Called when config has been updated and we need to apply any changes.
HttpManager.h
Overridden from FTSTickerObjectBase
Name
Remarks
Include Path
Unreal Specifiers
virtual bool Tick
(
float DeltaSeconds
)
FTSTicker callback
HttpManager.h
Protected
Name
Remarks
Include Path
Unreal Specifiers
void AddRequest
(
const FHttpRequestRef& Request
)
HttpManager.h
void BroadcastHttpRequestCompleted
(
const FHttpRequestRef& Request
)
Broadcast that a non-threaded HTTP request is complete.
HttpManager.h
virtual FHttpThreadBase * CreateHttpThread()
Create HTTP thread object
HttpManager.h
TOptional < int32 > GetMockFailure
(
FStringView Url
) const
HttpManager.h
FHttpThreadBase * GetThread()
Access http thread of http manager for internal usage
HttpManager.h
bool HasAnyBoundDelegate()
HttpManager.h
bool IsCurrentThreadCompletingRequest()
HttpManager.h
void MarkCurrentThreadCompletingRequest
(
bool bCompleting
)
HttpManager.h
void RecordMaxTimeToWaitInQueue
(
float Duration
)
Record the time to wait in queue, to have a general idea how long the client usually wait before actually starting, to adjust the requests
HttpManager.h
void RecordPlatformStats
(
const FHttpStatsPlatform & PlatformStats
)
Record platform specific stats
HttpManager.h
void RecordStatRequestsInFlight
(
uint32 RequestsInFlight
)
Record the requests waiting in flight, to have an idea if there are too many concurrent requests
HttpManager.h
void RecordStatRequestsInQueue
(
uint32 RequestsInQueue
)
Record the requests waiting in queue, to have an idea if there are too many requests or if request number limit is too small
HttpManager.h
void RecordStatTimeToConnect
(
float Duration
)
Record the time to connect, to have a general idea how long the client usually take to connect for success requests, to adjust the connection timeout
HttpManager.h
void ReloadFlushTimeLimits()
HttpManager.h
bool ShouldDisableFailedLog
(
FStringView Url
) const
HttpManager.h
bool ShouldLogResponse
(
FStringView Url
) const
HttpManager.h
void UpdateUrlPatternsToDisableFailedLog
(
IConsoleVariable * CVar
)
HttpManager.h
void UpdateUrlPatternsToLogResponse
(
IConsoleVariable * CVar
)
HttpManager.h
void UpdateUrlPatternsToMockFailure
(
IConsoleVariable * CVar
)
HttpManager.h
Static
Name
Remarks
Include Path
Unreal Specifiers
static TFunction < FString()> GetDefaultCorrelationIdMethod()
Get the default method for creating new correlation ids for a request
HttpManager.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Inheritance Hierarchy
Constructors
Destructors
Structs
Functions
Public
Overridden from FTSTickerObjectBase
Protected
Static
##### END UE 5.6 API: Runtime/HTTP/FHttpManager #####

##### BEGIN UE 5.6 API: Runtime/Engine/FTimerManager #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FTimerManager?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
FTimerManager | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FTimerManager
FTimerManager
Class to globally manage timers.
On this page Navigation
API > API/Runtime > API/Runtime/Engine
Class to globally manage timers.
Name
FTimerManager
Type
class
Header File
/Engine/Source/Runtime/Engine/Public/TimerManager.h
Include Path
#include "TimerManager.h"
Syntax
class FTimerManager : public FNoncopyable
Copy full snippet
class FTimerManager : public FNoncopyable
Inheritance Hierarchy
FNoncopyable → FTimerManager
Constructors
Name
Remarks
Include Path
Unreal Specifiers
FTimerManager
(
UGameInstance * GameInstance
)
Timer API
TimerManager.h
Destructors
Name
Remarks
Include Path
Unreal Specifiers
virtual ~FTimerManager()
TimerManager.h
Constants
Name
Type
Remarks
Include Path
LastAssignedSerialNumber
uint64
The last serial number we assigned from this timer manager
TimerManager.h
Variables
Protected
Name
Type
Remarks
Include Path
Unreal Specifiers
ActiveTimerHeap
TArray < FTimerHandle >
Heap of actively running timers.
TimerManager.h
CurrentlyExecutingTimer
FTimerHandle
Index to the timer delegate currently being executed, or INDEX_NONE if none are executing.
TimerManager.h
InternalTime
double
An internally consistent clock, independent of World. Advances during ticking.
TimerManager.h
LastTickedFrame
uint64
Set this to GFrameCounter when Timer is ticked.
TimerManager.h
ObjectToTimers
TMap < const void *, TSet < FTimerHandle > >
A map of object pointers to timers with delegates bound to those objects, for quick lookup
TimerManager.h
OwningGameInstance
UGameInstance *
The game instance that created this timer manager.
TimerManager.h
PausedTimerSet
TSet < FTimerHandle >
Set of paused timers.
TimerManager.h
PendingTimerSet
TSet < FTimerHandle >
Set of timers added this frame, to be added after timer has been ticked
TimerManager.h
Timers
TSparseArray < FTimerData >
The array of timers - all other arrays will index into this
TimerManager.h
TimerSourceList
TUniquePtr < FTimerSourceList >
Debugging/tracking information used when TimerManager.BuildTimerSourceList is set
TimerManager.h
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
void ClearAllTimersForObject
(
void const* Object
)
Clears all timers that are bound to functions on the given object.
TimerManager.h
void ClearTimer
(
FTimerHandle & InHandle
)
Clears a previously set timer, identical to calling SetTimer() with a <= 0.f rate.
TimerManager.h
FTimerHandle GenerateHandle
(
int32 Index
)
This should be private, but needs to be public for testing.
TimerManager.h
TStatId GetStatId()
TimerManager.h
float GetTimerElapsed
(
FTimerHandle InHandle
) const
Gets the current elapsed time for the specified timer.
TimerManager.h
float GetTimerRate
(
FTimerHandle InHandle
) const
Gets the current rate (time between activations) for the specified timer.
TimerManager.h
float GetTimerRemaining
(
FTimerHandle InHandle
) const
Gets the time remaining before the specified timer is called
TimerManager.h
bool HasBeenTickedThisFrame()
TimerManager.h
bool IsTimerActive
(
FTimerHandle InHandle
) const
Returns true if the specified timer exists and is not paused
TimerManager.h
bool IsTimerPaused
(
FTimerHandle InHandle
) const
Returns true if the specified timer exists and is paused
TimerManager.h
bool IsTimerPending
(
FTimerHandle InHandle
) const
Returns true if the specified timer exists and is pending
TimerManager.h
FTimerHandle K2_FindDynamicTimerHandle
(
FTimerDynamicDelegate InDynamicDelegate
) const
Finds a handle to a timer bound to a particular dynamic delegate.
TimerManager.h
void ListTimers()
Debug command to output info on all timers currently set to the log.
TimerManager.h
virtual void OnCrash()
Called from crash handler to provide more debug information.
TimerManager.h
void PauseTimer
(
FTimerHandle InHandle
)
Pauses a previously set timer.
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
FTimerDelegate const& InDelegate,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
Version that takes any generic delegate.
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
UserClass* InObj,
typename FTimerDelegate::TMethodPtr< UserClass > InTimerMethod,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
Sets a timer to call the given native function at a set interval.
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
TFunction < void(void)>&& Callback,
float InRate,
bool InbLoop,
float InFirstDelay
)
Version that takes a TFunction
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
FTimerDynamicDelegate const& InDynDelegate,
float InRate,
bool InbLoop,
float InFirstDelay
)
Version that takes a dynamic delegate (e.g. for UFunctions).
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
FTimerDelegate const& InDelegate,
float InRate,
bool InbLoop,
float InFirstDelay
)
Version that takes any generic delegate.
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
TFunction < void(void)>&& Callback,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
Version that takes a TFunction
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
FTimerDynamicDelegate const& InDynDelegate,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
Version that takes a dynamic delegate (e.g. for UFunctions).
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
UserClass* InObj,
typename FTimerDelegate::TMethodPtr< UserClass > InTimerMethod,
float InRate,
bool InbLoop,
float InFirstDelay
)
Sets a timer to call the given native function at a set interval.
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
float InRate,
bool InbLoop,
float InFirstDelay
)
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
UserClass* InObj,
typename FTimerDelegate::TConstMethodPtr< UserClass > InTimerMethod,
float InRate,
const FTimerManagerTimerParameters & InTimerParameters
)
TimerManager.h
void SetTimer
(
FTimerHandle & InOutHandle,
UserClass* InObj,
typename FTimerDelegate::TConstMethodPtr< UserClass > InTimerMethod,
float InRate,
bool InbLoop,
float InFirstDelay
)
TimerManager.h
FTimerHandle SetTimerForNextTick
(
TFunction < void(void)>&& Callback
)
Version that takes a TFunction
TimerManager.h
FTimerHandle SetTimerForNextTick
(
FTimerDynamicDelegate const& InDynDelegate
)
Version that takes a dynamic delegate (e.g. for UFunctions).
TimerManager.h
FTimerHandle SetTimerForNextTick
(
FTimerDelegate const& InDelegate
)
Version that takes any generic delegate.
TimerManager.h
FTimerHandle SetTimerForNextTick
(
UserClass* inObj,
typename FTimerDelegate::TConstMethodPtr< UserClass > inTimerMethod
)
TimerManager.h
FTimerHandle SetTimerForNextTick
(
UserClass* inObj,
typename FTimerDelegate::TMethodPtr< UserClass > inTimerMethod
)
Sets a timer to call the given native function on the next tick.
TimerManager.h
void Tick
(
float DeltaTime
)
TimerManager.h
bool TimerExists
(
FTimerHandle InHandle
) const
Returns true if the specified timer exists
TimerManager.h
void UnPauseTimer
(
FTimerHandle InHandle
)
Unpauses a previously set timer
TimerManager.h
Protected
Name
Remarks
Include Path
Unreal Specifiers
FTimerData * FindTimer
(
FTimerHandle const& InHandle
)
TimerManager.h
FTimerData const * FindTimer
(
FTimerHandle const& InHandle
) const
These should be private, but need to be protected so IMPLEMENT_GET_PROTECTED_FUNC works for testing.
TimerManager.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Inheritance Hierarchy
Constructors
Destructors
Constants
Variables
Protected
Functions
Public
Protected
##### END UE 5.6 API: Runtime/Engine/FTimerManager #####

##### BEGIN UE 5.6 API: Runtime/Core/FTSTicker #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/FTSTicker?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
FTSTicker | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FTSTicker
FTSTicker
Thread-safe ticker class. Fires delegates after a delay.
On this page Navigation
API > API/Runtime > API/Runtime/Core
Thread-safe ticker class. Fires delegates after a delay.
Name
FTSTicker
Type
class
Header File
/Engine/Source/Runtime/Core/Public/Containers/Ticker.h
Include Path
#include "Containers/Ticker.h"
Syntax
class FTSTicker
Copy full snippet
class FTSTicker
Derived Classes
FTSBackgroundableTicker
Structs
Name
Remarks
FElement
Internal structure to store a ticker delegate and related data
Typedefs
Name
Type
Remarks
Include Path
FDelegateHandle
TWeakPtr < FElement >
Containers/Ticker.h
FElementPtr
TSharedPtr < FElement >
Containers/Ticker.h
Variables
Protected
Name
Type
Remarks
Include Path
Unreal Specifiers
AddedElements
TMpscQueue < FElementPtr >
All added delegates are initially stored in a separate thread-safe queue and then in the next Tick are moved to the main not thread-safe container
Containers/Ticker.h
CurrentTime
std::atomic< double >
Current time of the ticker
Containers/Ticker.h
Elements
TArray < FElementPtr >
Future delegates to fire
Containers/Ticker.h
Functions
Public
Name
Remarks
Include Path
Unreal Specifiers
FDelegateHandle AddTicker
(
const FTickerDelegate& InDelegate,
float InDelay
)
Add a new ticker with a given delay / interval
Containers/Ticker.h
FDelegateHandle AddTicker
(
const TCHAR* InName,
float InDelay,
TUniqueFunction < bool(float)>&& InFunction
)
Add a new ticker with a given delay / interval.Can be called concurrently.
Containers/Ticker.h
void Reset()
Resets the instance to its default state. Must be called from the ticking thread.
Containers/Ticker.h
void Tick
(
float DeltaTime
)
Fire all tickers who have passed their delay and reschedule the ones that return true
Containers/Ticker.h
Static
Name
Remarks
Include Path
Unreal Specifiers
static FTSTicker & GetCoreTicker ()
Singleton used for the ticker in Core / Launch.
Containers/Ticker.h
static void RemoveTicker
(
FDelegateHandle Handle
)
Removes a previously added ticker delegate.
Containers/Ticker.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Derived Classes
Structs
Typedefs
Variables
Protected
Functions
Public
Static
##### END UE 5.6 API: Runtime/Core/FTSTicker #####

##### BEGIN UE 5.6 API: Runtime/Json/FJsonSerializer #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Json/FJsonSerializer?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
FJsonSerializer | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FJsonSerializer
FJsonSerializer
On this page Navigation
API > API/Runtime > API/Runtime/Json
Name
FJsonSerializer
Type
class
Header File
/Engine/Source/Runtime/Json/Public/Serialization/JsonSerializer.h
Include Path
#include "Serialization/JsonSerializer.h"
Syntax
class FJsonSerializer
Copy full snippet
class FJsonSerializer
Structs
Name
Remarks
FElement
StackState
Enums
Public
Name
Remarks
EFlags
Functions
Static
Name
Remarks
Include Path
Unreal Specifiers
static bool Deserialize
(
const TSharedRef < TJsonReader < CharType > >& Reader,
TArray < TSharedPtr < FJsonValue > >& OutArray,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Deserialize
(
TJsonReader < CharType >& Reader,
TArray < TSharedPtr < FJsonValue > >& OutArray,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Deserialize
(
const TSharedRef < TJsonReader < CharType > >& Reader,
TSharedPtr < FJsonObject >& OutObject,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Deserialize
(
TJsonReader < CharType >& Reader,
TSharedPtr < FJsonObject >& OutObject,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Deserialize
(
const TSharedRef < TJsonReader < CharType > >& Reader,
TSharedPtr < FJsonValue >& OutValue,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Deserialize
(
TJsonReader < CharType >& Reader,
TSharedPtr < FJsonValue >& OutValue,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Deserialize
(
TJsonReader < CharType >& Reader,
StackState& OutStackState,
EFlags InOptions
)
Serialization/JsonSerializer.h
static bool Serialize
(
const TArray < TSharedPtr < FJsonValue > >& Array,
const TSharedRef < TJsonWriter < CharType, PrintPolicy > >& Writer,
bool bCloseWriter
)
Serialize the passed array of json values into the writer.
Serialization/JsonSerializer.h
static bool Serialize
(
const TArray < TSharedPtr < FJsonValue > >& Array,
TJsonWriter < CharType, PrintPolicy >& Writer,
bool bCloseWriter
)
Serialize the passed array of json values into the writer.
Serialization/JsonSerializer.h
static bool Serialize
(
const TSharedRef < FJsonObject >& Object,
const TSharedRef < TJsonWriter < CharType, PrintPolicy > >& Writer,
bool bCloseWriter
)
Serialize the passed Json object into the writer.
Serialization/JsonSerializer.h
static bool Serialize
(
const TSharedRef < FJsonObject >& Object,
TJsonWriter < CharType, PrintPolicy >& Writer,
bool bCloseWriter
)
Serialize the passed Json object into the writer.
Serialization/JsonSerializer.h
static bool Serialize
(
const TSharedRef < FElement >& StartingElement,
TJsonWriter < CharType, PrintPolicy >& Writer,
bool bCloseWriter
)
Serialization/JsonSerializer.h
static bool Serialize
(
const TSharedPtr < FJsonValue >& Value,
const FString& Identifier,
const TSharedRef < TJsonWriter < CharType, PrintPolicy > >& Writer,
bool bCloseWriter
)
Serialize the passed Json value and identifier into the writer.
Serialization/JsonSerializer.h
static bool Serialize
(
const TSharedPtr < FJsonValue >& Value,
const FString& Identifier,
TJsonWriter < CharType, PrintPolicy >& Writer,
bool bCloseWriter
)
Serialize the passed Json value and identifier into the writer.
Serialization/JsonSerializer.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Structs
Enums
Public
Functions
Static
##### END UE 5.6 API: Runtime/Json/FJsonSerializer #####

##### BEGIN UE 5.6 API: Runtime/JsonUtilities/FJsonObjectConverter #####
# Source: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/JsonUtilities/FJsonObjectConverter?application_version=5.6
# Note: Text extracted from the page's HTML (scripts, styles and tags removed, whitespace collapsed); the wording is the page's own.
FJsonObjectConverter | Unreal Engine 5.6 Documentation | Epic Developer Community
Table of Contents Developer
FJsonObjectConverter
FJsonObjectConverter
Class that handles converting Json objects to and from UStructs
On this page Navigation
API > API/Runtime > API/Runtime/JsonUtilities
Class that handles converting Json objects to and from UStructs
Name
FJsonObjectConverter
Type
class
Header File
/Engine/Source/Runtime/JsonUtilities/Public/JsonObjectConverter.h
Include Path
#include "JsonObjectConverter.h"
Syntax
class FJsonObjectConverter
Copy full snippet
class FJsonObjectConverter
Typedefs
Name
Type
Remarks
Include Path
CustomExportCallback
TDelegate < TSharedPtr < FJsonValue >( FProperty * Property , const void * Value )>
Optional callback that will be run when exporting a single property to Json.
JsonObjectConverter.h
CustomImportCallback
TDelegate < bool(const TSharedPtr < FJsonValue > &JsonValue, FProperty * Property , void * Value )>
Optional callback that will be run when importing a single property from Json.
JsonObjectConverter.h
Constants
Name
Type
Remarks
Include Path
ExportCallback_WriteISO8601Dates
const CustomExportCallback
JsonObjectConverter.h
Functions
Static
Name
Remarks
Include Path
Unreal Specifiers
static bool GetTextFromField
(
const FString& FieldName,
const TSharedPtr < FJsonValue >& FieldValue,
FText & TextOut
)
Convert a Json value to text (takes some hints from the value name)
JsonObjectConverter.h
static bool GetTextFromObject
(
const TSharedRef < FJsonObject >& Obj,
FText & TextOut
)
Parse an FText from a json object (assumed to be of the form where keys are culture codes and values are strings)
JsonObjectConverter.h
static bool JsonArrayStringToUStruct
(
const FString& JsonString,
TArray < OutStructType >* OutStructArray,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Converts from a json string containing an array to an array of UStructs
JsonObjectConverter.h
static bool JsonArrayToUStruct
(
const TArray < TSharedPtr < FJsonValue > >& JsonArray,
TArray < OutStructType >* OutStructArray,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Converts from an array of json values to an array of UStructs.
JsonObjectConverter.h
static bool JsonAttributesToUStruct
(
const TMap < FString, TSharedPtr < FJsonValue > >& JsonAttributes,
const UStruct * StructDefinition,
void* OutStruct,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Converts a set of json attributes (possibly from within a JsonObject) to a UStruct , using importText
JsonObjectConverter.h
static bool JsonObjectStringToUStruct
(
const FString& JsonString,
OutStructType* OutStruct,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Converts from a json string containing an object to a UStruct
JsonObjectConverter.h
static bool JsonObjectToUStruct
(
const TSharedRef < FJsonObject >& JsonObject,
const UStruct * StructDefinition,
void* OutStruct,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Converts from a Json Object to a UStruct , using importText
JsonObjectConverter.h
static bool JsonObjectToUStruct
(
const TSharedRef < FJsonObject >& JsonObject,
OutStructType* OutStruct,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Templated version of JsonObjectToUStruct
JsonObjectConverter.h
static bool JsonValueToUProperty
(
const TSharedPtr < FJsonValue >& JsonValue,
FProperty * Property,
void* OutValue,
int64 CheckFlags,
int64 SkipFlags,
const bool bStrictMode,
FText * OutFailReason,
const CustomImportCallback* ImportCb
)
Converts a single JsonValue to the corresponding FProperty (this may recurse if the property is a UStruct for instance).
JsonObjectConverter.h
static FFormatNamedArguments ParseTextArgumentsFromJson
(
const TSharedPtr < const FJsonObject >& JsonObject
)
Parses text arguments from Json into a map
JsonObjectConverter.h
static FString StandardizeCase
(
const FString& StringIn
)
FName case insensitivity can make the casing of UPROPERTIES unpredictable.
JsonObjectConverter.h
static TSharedPtr < FJsonValue > UPropertyToJsonValue
(
FProperty * Property,
const void* Value,
int64 CheckFlags,
int64 SkipFlags,
const CustomExportCallback* ExportCb,
FProperty * OuterProperty,
EJsonObjectConversionFlags ConversionFlags
)
* Converts from a FProperty to a Json Value using exportText
JsonObjectConverter.h
static bool UStructToFormattedJsonObjectString
(
const UStruct * StructDefinition,
const void* Struct,
FString& OutJsonString,
int64 CheckFlags,
int64 SkipFlags,
int32 Indent,
const CustomExportCallback* ExportCb,
EJsonObjectConversionFlags ConversionFlags
)
Wrapper to UStructToJsonObjectString that allows a print policy to be specified.
JsonObjectConverter.h
static bool UStructToJsonAttributes
(
const UStruct * StructDefinition,
const void* Struct,
TMap < FString, TSharedPtr < FJsonValue > >& OutJsonAttributes,
int64 CheckFlags,
int64 SkipFlags,
const CustomExportCallback* ExportCb,
EJsonObjectConversionFlags ConversionFlags
)
Converts from a UStruct to a set of json attributes (possibly from within a JsonObject)
JsonObjectConverter.h
static TSharedPtr < FJsonObject > UStructToJsonObject
(
const InStructType& InStruct,
int64 CheckFlags,
int64 SkipFlags,
const CustomExportCallback* ExportCb
)
Templated version of UStructToJsonObject to try and make most of the params.
JsonObjectConverter.h
static bool UStructToJsonObject
(
const UStruct * StructDefinition,
const void* Struct,
TSharedRef < FJsonObject > OutJsonObject,
int64 CheckFlags,
int64 SkipFlags,
const CustomExportCallback* ExportCb,
EJsonObjectConversionFlags ConversionFlags
)
Converts from a UStruct to a Json Object, using exportText
JsonObjectConverter.h
static bool UStructToJsonObjectString
(
const InStructType& InStruct,
FString& OutJsonString,
int64 CheckFlags,
int64 SkipFlags,
int32 Indent,
const CustomExportCallback* ExportCb,
bool bPrettyPrint
)
Templated version; Converts from a UStruct to a json string containing an object, using exportText
JsonObjectConverter.h
static bool UStructToJsonObjectString
(
const UStruct * StructDefinition,
const void* Struct,
FString& OutJsonString,
int64 CheckFlags,
int64 SkipFlags,
int32 Indent,
const CustomExportCallback* ExportCb,
bool bPrettyPrint
)
Converts from a UStruct to a json string containing an object, using exportText
JsonObjectConverter.h
Ask questions and help your peers Developer Forums
Write your own tutorials or read those from others Learning Library
On this page
Navigation
Syntax
Typedefs
Constants
Functions
Static
##### END UE 5.6 API: Runtime/JsonUtilities/FJsonObjectConverter #####
